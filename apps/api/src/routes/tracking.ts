import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { calculateItemStatus } from '@pdits/shared/src/utils/calculateStatus';

export default async function trackingRoutes(server: FastifyInstance) {
  // GET /api/v1/tracking/daily
  server.get('/api/v1/tracking/daily', { preValidation: [authenticate] }, async (request, reply) => {
    const { item_code, date, shift } = request.query as { item_code?: string; date?: string; shift?: string };

    if (!item_code || !date) {
      return reply.code(400).send({ error: 'Bad Request', message: 'item_code and date are required' });
    }

    const item = await prisma.item.findUnique({ where: { partNumber: item_code } });
    if (!item) {
      return reply.code(404).send({ error: 'Not Found', message: 'Item not found' });
    }

    const targetDate = new Date(date);

    // Get Demand
    const dailySchedule = await prisma.dailySchedule.findFirst({
      where: {
        itemId: item.id,
        date: targetDate,
        ...(shift ? { shift: parseInt(shift) } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const demand = dailySchedule?.quantity || 0;

    // Get FG Stock
    const fgStockObj = await prisma.fGStock.findUnique({ where: { itemId: item.id } });
    const fgStock = fgStockObj?.quantity || 0;

    // WIP modul PRODUCTION saja — WIP Material Planning disimpan terpisah.
    const wips = await prisma.wIP.findMany({ where: { itemId: item.id, moduleType: 'PRODUCTION' } });
    const totalWip = wips.reduce((acc, curr) => acc + curr.quantity, 0);

    const { status, gap, totalSupply } = calculateItemStatus({ demand, fgStock, wip: totalWip });

    return reply.send({
      item_code,
      item_name: item.itemName,
      date,
      demand,
      fg_stock: fgStock,
      in_production: totalWip,
      total_supply: totalSupply,
      gap,
      status,
      wip_details: wips.map((w) => ({
        wip_id: w.id,
        location: w.location,
        qty: w.quantity,
        progress_pct: w.progressPercent,
        shift: w.shift,
        date: w.date.toISOString().split('T')[0],
        status: w.status,
      })),
    });
  });

  // GET /api/v1/tracking/dashboard
  server.get('/api/v1/tracking/dashboard', { preValidation: [authenticate] }, async (request, reply) => {
    const { date, shift } = request.query as { date?: string; shift?: string };
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setUTCHours(0, 0, 0, 0);

    const items = await prisma.item.findMany();
    const masterCartons = await prisma.masterCarton.findMany({
      include: { toyNameItem: true }
    });

    const mcMap = new Map<string, typeof masterCartons[0]>();
    for (const mc of masterCartons) {
      mcMap.set(mc.partNumberCode, mc);
    }
    
    // In a real scenario, this would be highly optimized using SQL aggregation.
    // For this implementation, we map over items to calculate individual statuses.
    let fulfilledCount = 0;
    let inProductionCount = 0;
    let shortageCount = 0;
    const gapAnalysis = [];
    const wipStatusList = [];

    for (const item of items) {
      const schedule = await prisma.dailySchedule.findFirst({
        where: {
          itemId: item.id,
          date: targetDate,
          ...(shift ? { shift: parseInt(shift) } : {}),
        },
      });
      const demand = schedule?.quantity || 0;

      const fgStockObj = await prisma.fGStock.findUnique({ where: { itemId: item.id } });
      const fgStock = fgStockObj?.quantity || 0;

      const wips = await prisma.wIP.findMany({ where: { itemId: item.id, moduleType: 'PRODUCTION' } });
      const totalWip = wips.reduce((acc, curr) => acc + curr.quantity, 0);

      const { status, gap } = calculateItemStatus({ demand, fgStock, wip: totalWip });

      if (status === 'FULFILLED') fulfilledCount++;
      else if (status === 'IN_PRODUCTION') inProductionCount++;
      else if (status === 'SHORTAGE') shortageCount++;

      const mc = mcMap.get(item.partNumber);
      const toyName = mc ? mc.toyNameItem.itemName : '-';
      const masterCarton = mc ? mc.cartonCode : '-';

      gapAnalysis.push({
        partNumber: item.partNumber,
        itemCode: item.partNumber,
        itemName: item.itemName,
        toyName,
        masterCarton,
        demand,
        fgStock,
        wip: totalWip,
        gap,
        status,
      });

      for (const w of wips) {
        wipStatusList.push({
          partNumber: item.partNumber,
          itemCode: item.partNumber,
          itemName: item.itemName,
          location: w.location,
          qty: w.quantity,
          progress: w.progressPercent,
        });
      }
    }

    return reply.send({
      summary: {
        totalItems: items.length,
        fulfilled: fulfilledCount,
        inProduction: inProductionCount,
        shortage: shortageCount,
      },
      gapAnalysis,
      wipStatus: wipStatusList,
    });
  });

  // GET /api/v1/tracking/shortage-details
  server.get('/api/v1/tracking/shortage-details', { preValidation: [authenticate] }, async (request, reply) => {
    const { date } = request.query as { date?: string };
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setUTCHours(0, 0, 0, 0);

    // 1. Batch load data in 5 optimized queries
    const items = await prisma.item.findMany();
    const fgStocks = await prisma.fGStock.findMany();
    const wips = await prisma.wIP.findMany({
      where: {
        moduleType: 'PRODUCTION',
        status: { in: ['IN_PROGRESS', 'ON_HOLD', 'DELAYED'] }
      }
    });
    const dailySchedules = await prisma.dailySchedule.findMany({
      where: { date: targetDate }
    });
    const weeklySchedules = await prisma.weeklySchedule.findMany({
      where: {
        moduleType: 'PRODUCTION',
        weekStartDate: { gte: targetDate }
      },
      orderBy: [{ weekStartDate: 'asc' }]
    });

    const masterCartons = await prisma.masterCarton.findMany({
      include: { toyNameItem: true }
    });
    
    // 2. Build maps for O(1) lookups
    const fgStockMap = new Map<string, number>();
    for (const stock of fgStocks) {
      fgStockMap.set(stock.itemId, stock.quantity);
    }

    const wipMap = new Map<string, number>();
    for (const wip of wips) {
      const current = wipMap.get(wip.itemId) || 0;
      wipMap.set(wip.itemId, current + wip.quantity);
    }

    const itemMap = new Map<string, typeof items[0]>();
    for (const item of items) {
      itemMap.set(item.id, item);
    }

    const mcMap = new Map<string, typeof masterCartons[0]>();
    for (const mc of masterCartons) {
      mcMap.set(mc.partNumberCode, mc);
    }

    // 3. Calculate Demands
    const dailyDemandMap = new Map<string, number>();
    for (const sched of dailySchedules) {
      const current = dailyDemandMap.get(sched.itemId) || 0;
      dailyDemandMap.set(sched.itemId, current + sched.quantity);
    }

    const weeklyDemandMap = new Map<string, number>();
    for (const sched of weeklySchedules) {
      const current = weeklyDemandMap.get(sched.itemId) || 0;
      weeklyDemandMap.set(sched.itemId, current + sched.quantity);
    }

    // 4. Build Unified Shortages
    const unifiedShortages = [];
    let shiftShortagesCount = 0;
    let dailyShortagesCount = 0;
    let weeklyShortagesCount = 0;
    
    const countedDaily = new Set<string>();
    const countedWeekly = new Set<string>();

    for (const sched of dailySchedules) {
      const item = itemMap.get(sched.itemId);
      if (!item) continue;

      const mc = mcMap.get(item.partNumber);
      const toyName = mc ? mc.toyNameItem.itemName : '-';
      const masterCarton = mc ? mc.cartonCode : '-';

      const fgStock = fgStockMap.get(sched.itemId) || 0;
      const wip = wipMap.get(sched.itemId) || 0;
      const totalSupply = fgStock + wip;

      const shiftDemand = sched.quantity;
      const dailyDemand = dailyDemandMap.get(sched.itemId) || 0;
      const weeklyDemand = weeklyDemandMap.get(sched.itemId) || 0;

      const shiftGap = totalSupply - shiftDemand;
      const dailyGap = totalSupply - dailyDemand;
      const weeklyGap = totalSupply - weeklyDemand;

      const dailyShortage = dailyGap < 0 ? Math.abs(dailyGap) : 0;
      const weeklyShortage = weeklyGap < 0 ? Math.abs(weeklyGap) : 0;
      
      let isAnyShortage = false;

      if (shiftGap < 0) {
        shiftShortagesCount++;
        isAnyShortage = true;
      }
      
      if (dailyGap < 0) {
        isAnyShortage = true;
        if (!countedDaily.has(sched.itemId)) {
          dailyShortagesCount++;
          countedDaily.add(sched.itemId);
        }
      }
      
      if (weeklyGap < 0) {
        isAnyShortage = true;
        if (!countedWeekly.has(sched.itemId)) {
          weeklyShortagesCount++;
          countedWeekly.add(sched.itemId);
        }
      }

      if (isAnyShortage) {
        unifiedShortages.push({
          itemId: sched.itemId,
          toyName,
          masterCarton,
          partNumber: item.partNumber,
          itemCode: item.partNumber,
          date: sched.date.toISOString().split('T')[0],
          shift: sched.shift,
          dailyDemand,
          weeklyDemand,
          fgStock,
          wip,
          dailyShortage,
          weeklyShortage,
          status: 'SHORTAGE',
        });
      }
    }

    return reply.send({
      unifiedShortages,
      shiftShortagesCount,
      dailyShortagesCount,
      weeklyShortagesCount
    });
  });
}

