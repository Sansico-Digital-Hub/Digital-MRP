import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

export default async function historyRoutes(server: FastifyInstance) {
  server.get('/api/v1/history/weekly', { preValidation: [authenticate] }, async (request, reply) => {
    const { start_date, end_date, search, page = '1', limit = '50', perf_min, perf_max } = request.query as {
      start_date?: string;
      end_date?: string;
      search?: string;
      page?: string;
      limit?: string;
      perf_min?: string;
      perf_max?: string;
    };
    
    // Default to last 7 days if not provided
    const targetStartDate = start_date ? new Date(start_date) : new Date(new Date().setDate(new Date().getDate() - 7));
    targetStartDate.setUTCHours(0, 0, 0, 0);
    
    const targetEndDate = end_date ? new Date(end_date) : new Date();
    targetEndDate.setUTCHours(23, 59, 59, 999);

    // Build item query filter
    const whereClause: any = {};
    if (search) {
      whereClause.OR = [
        { partNumber: { contains: search } },
        { description: { contains: search } }
      ];
    }

    const parsedPage = parseInt(page, 10) || 1;
    const parsedLimit = parseInt(limit, 10) || 50;
    const skip = (parsedPage - 1) * parsedLimit;

    // Create a list of dates to analyze
    const dates = [];
    for (let d = new Date(targetStartDate); d <= targetEndDate; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d));
    }

    // 1. Fetch ALL matching items to perform simulation in memory for filtering
    const allMatchingItems = await prisma.item.findMany({
      where: whereClause,
      orderBy: { partNumber: 'asc' }
    });
    const allItemIds = allMatchingItems.map(i => i.id);

    // 2. Fetch schedules and FG for all matching items
    const allSchedules = allItemIds.length > 0 ? await prisma.dailySchedule.findMany({
      where: { 
        itemId: { in: allItemIds },
        date: { gte: targetStartDate, lte: targetEndDate }
      }
    }) : [];

    const allGlobalFg = allItemIds.length > 0 ? await prisma.fGStock.findMany({
      where: { 
        itemId: { in: allItemIds },
        date: { lte: targetEndDate }
      },
      orderBy: { date: 'asc' }
    }) : [];

    // Grouping
    const globalSchedulesByItem = new Map<string, any[]>();
    for (const s of allSchedules) {
      if (!globalSchedulesByItem.has(s.itemId)) globalSchedulesByItem.set(s.itemId, []);
      globalSchedulesByItem.get(s.itemId)!.push(s);
    }

    const globalFgByItem = new Map<string, any[]>();
    for (const f of allGlobalFg) {
      if (!globalFgByItem.has(f.itemId)) globalFgByItem.set(f.itemId, []);
      globalFgByItem.get(f.itemId)!.push(f);
    }

    // Run simulation for ALL items to get performance metrics and global summary
    let globalDemand = 0;
    let globalGap = 0;

    const simulatedItems = [];

    for (const item of allMatchingItems) {
      const itemSchedules = globalSchedulesByItem.get(item.id) || [];
      const itemFg = globalFgByItem.get(item.id) || [];
      let fgBalance = 0;
      let fgIndex = 0;

      let weeklyDemand = 0;
      let weeklyFg = 0;
      let activeDaysCount = 0;
      let totalDailyFulfillment = 0;

      for (const d of dates) {
        while (fgIndex < itemFg.length && itemFg[fgIndex].date.getTime() <= d.getTime()) {
          fgBalance = itemFg[fgIndex].quantity;
          fgIndex++;
        }
        const demandToday = itemSchedules
          .filter(s => s.date.getTime() === d.getTime())
          .reduce((sum, s) => sum + s.quantity, 0);

        const gap = demandToday - fgBalance;
        const shortage = gap > 0 ? gap : 0;

        globalDemand += demandToday;
        globalGap += shortage;

        weeklyDemand += demandToday;
        weeklyFg += fgBalance;
        
        const fulfillmentPercent = demandToday > 0 ? Math.min(100, (fgBalance / demandToday) * 100) : (fgBalance > 0 ? 100 : 0);
        if (demandToday > 0) {
          activeDaysCount++;
          totalDailyFulfillment += fulfillmentPercent;
        }
      }

      const weeklyFulfillmentPercent = activeDaysCount > 0 ? (totalDailyFulfillment / activeDaysCount) : 100;

      simulatedItems.push({
        item,
        weeklyDemand,
        weeklyFg,
        weeklyFulfillmentPercent: Math.round(weeklyFulfillmentPercent * 100) / 100
      });
    }

    // 3. Filter simulated items by performance range if requested
    let filteredSimulatedItems = simulatedItems;
    if (perf_min !== undefined && perf_max !== undefined) {
      const minVal = parseFloat(perf_min);
      const maxVal = parseFloat(perf_max);
      filteredSimulatedItems = simulatedItems.filter(p => {
        return p.weeklyFulfillmentPercent >= minVal && p.weeklyFulfillmentPercent <= maxVal;
      });
    }

    const total = filteredSimulatedItems.length;
    const paginatedItems = filteredSimulatedItems.slice(skip, skip + parsedLimit);
    const paginatedItemIds = paginatedItems.map(p => p.item.id);

    // 4. Fetch daily WIP only for the paginated items to optimize speed
    // WIP modul PRODUCTION saja — WIP Material Planning disimpan terpisah.
    const allWip = paginatedItemIds.length > 0 ? await prisma.wIP.findMany({
      where: { 
        itemId: { in: paginatedItemIds },
        moduleType: 'PRODUCTION',
        date: { lte: targetEndDate }, 
        status: { in: ['IN_PROGRESS', 'ON_HOLD', 'DELAYED'] } 
      },
      orderBy: [{ date: 'asc' }, { shift: 'asc' }]
    }) : [];

    const wipByItem = new Map<string, any[]>();
    for (const w of allWip) {
      if (!wipByItem.has(w.itemId)) wipByItem.set(w.itemId, []);
      wipByItem.get(w.itemId)!.push(w);
    }

    // 5. Build results payload with daily details for the paginated page
    const results = [];

    for (const p of paginatedItems) {
      const item = p.item;
      const itemSchedules = globalSchedulesByItem.get(item.id) || [];
      const itemFg = globalFgByItem.get(item.id) || [];
      const itemWip = wipByItem.get(item.id) || [];

      let fgBalance = 0;
      let wipState = new Map<string, number>();
      let fgIndex = 0;
      let wipIndex = 0;

      const dailyData = [];

      for (const d of dates) {
        while (fgIndex < itemFg.length && itemFg[fgIndex].date.getTime() <= d.getTime()) {
          fgBalance = itemFg[fgIndex].quantity;
          fgIndex++;
        }
        while (wipIndex < itemWip.length && itemWip[wipIndex].date.getTime() <= d.getTime()) {
          wipState.set(itemWip[wipIndex].location, itemWip[wipIndex].quantity);
          wipIndex++;
        }

        const demandToday = itemSchedules
          .filter(s => s.date.getTime() === d.getTime())
          .reduce((sum, s) => sum + s.quantity, 0);

        const wipToday = Array.from(wipState.values()).reduce((sum, q) => sum + q, 0);
        
        const gap = demandToday - fgBalance;
        const shortage = gap > 0 ? gap : 0;
        const unproduced = shortage > wipToday ? shortage - wipToday : 0;
        const fulfillmentPercent = demandToday > 0 ? Math.min(100, (fgBalance / demandToday) * 100) : (fgBalance > 0 ? 100 : 0);

        dailyData.push({
          date: d.toISOString(),
          demand: demandToday,
          fgStock: fgBalance,
          wip: wipToday,
          shortage,
          unproduced,
          fulfillmentPercent: Math.round(fulfillmentPercent * 100) / 100
        });
      }

      results.push({
        itemId: item.id,
        partNumber: item.partNumber,
        description: item.itemName,
        daily: dailyData,
        summary: {
          weeklyDemand: p.weeklyDemand,
          weeklyFg: p.weeklyFg,
          weeklyFulfillmentPercent: p.weeklyFulfillmentPercent
        }
      });
    }

    const globalFulfilled = Math.max(0, globalDemand - globalGap);
    const globalFulfillmentPercent = globalDemand > 0 ? (globalFulfilled / globalDemand) * 100 : 100;

    return reply.send({
      startDate: targetStartDate,
      endDate: targetEndDate,
      data: results,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit)
      },
      globalSummary: {
        totalGap: globalGap,
        fulfillmentPercent: Math.round(globalFulfillmentPercent * 100) / 100
      }
    });
  });
}
