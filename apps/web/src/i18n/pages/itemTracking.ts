/**
 * Terjemahan halaman Item Tracking.
 * Namespace: `itemTracking.*`
 */
export default {
  id: {
    breadcrumb: {
      dashboard: 'Dashboard',
    },
    title: 'Item Tracking & Analisis Gap',
    subtitle:
      'Menganalisis kecukupan stok Finish Good (FG) dan Work in Progress (WIP) terhadap kebutuhan produksi (demand).',
    backToSearch: 'Kembali ke Pencarian',
    filter: {
      adjust: 'Sesuaikan Filter Pelacakan',
      select: 'Pilih Part Number & Tanggal Pelacakan',
      partNumber: 'Part Number',
      searchPlaceholder: 'Cari part number atau nama...',
      demandDate: 'Tanggal Demand',
      productionShift: 'Shift Produksi',
      allShifts: 'Semua Shift (1, 2, 3)',
      shiftLabel: 'Shift {n}',
    },
    empty: {
      title: 'Mulai Pelacakan Part Number',
      desc: 'Gunakan pencarian di atas untuk memilih part number. Sistem akan menampilkan analisis kebutuhan harian, ketersediaan gudang saat ini (FG), sisa proses di lantai produksi (WIP), serta kalkulasi gap secara langsung.',
    },
    error: {
      title: 'Gagal Memuat Data Tracking',
      retry: 'Coba Lagi',
    },
    header: {
      unit: 'Satuan Ukuran:',
      trackingDate: 'Tanggal Pelacakan:',
      shift: 'Shift:',
      snapshot: 'Dihitung berdasarkan real-time database snapshot',
    },
    status: {
      fulfilled: 'FULFILLED',
      inProduction: 'IN PRODUCTION',
      shortage: 'SHORTAGE',
    },
    summary: {
      demand: 'Demand',
      demandHint: 'Target demand harian',
      fgStock: 'Finish Good Stock',
      fgStockHint: 'Stok siap kirim di gudang',
      wip: 'Work In Progress',
      wipHint: 'Sedang diproduksi di mesin',
      gap: 'Gap Analisis',
      gapShortage: '⚠️ Kurang dari target demand',
      gapSafe: '✅ Aman memenuhi target demand',
    },
    chart: {
      title: 'Grafik Kebutuhan vs Pasokan',
      noDemand:
        'Tidak ada target Demand terdaftar pada hari ini. Stok FG yang tersedia ({count} {unit}) aman dari kekurangan.',
      supplyProgress: 'Progres Pasokan (FG + WIP)',
      totalSupply: 'Total Pasokan: {supplied} / {demand} {unit} ({pct}%)',
      fgBarLabel: 'FG: {count}',
      wipBarLabel: 'WIP: {count}',
      target: 'Target',
      targetDemand: 'Target Demand',
      fgTooltip: 'Stok FG: {count} {unit}',
      wipTooltip: 'WIP: {count} {unit}',
      legendFg: 'Selesai / Ready Stock (FG): {count} {unit}',
      legendWip: 'Proses Produksi (WIP): {count} {unit}',
      legendDemand: 'Garis Sasaran (Demand): {count} {unit}',
    },
    wipTable: {
      title: 'Detail Pekerjaan WIP Aktif',
      desc: 'Menampilkan rincian stasiun kerja dan kapasitas item ini yang sedang diproduksi.',
      registered: '{count} WIP Terdaftar',
      empty: 'Tidak ada aktivitas WIP aktif untuk item ini di lini produksi.',
      col: {
        workstation: 'Stasiun Kerja / Lokasi',
        shift: 'Shift',
        progress: 'Progres WIP',
        startDate: 'Tanggal Mulai',
      },
    },
  },
  en: {
    breadcrumb: {
      dashboard: 'Dashboard',
    },
    title: 'Item Tracking & Gap Analysis',
    subtitle:
      'Analyzes the adequacy of Finished Good (FG) and Work in Progress (WIP) stock against production demand.',
    backToSearch: 'Back to Search',
    filter: {
      adjust: 'Adjust Tracking Filter',
      select: 'Select Part Number & Tracking Date',
      partNumber: 'Part Number',
      searchPlaceholder: 'Search part number or name...',
      demandDate: 'Demand Date',
      productionShift: 'Production Shift',
      allShifts: 'All Shifts (1, 2, 3)',
      shiftLabel: 'Shift {n}',
    },
    empty: {
      title: 'Start Part Number Tracking',
      desc: 'Use the search above to select a part number. The system will display daily demand analysis, current warehouse availability (FG), remaining work on the production floor (WIP), and gap calculations in real time.',
    },
    error: {
      title: 'Failed to Load Tracking Data',
      retry: 'Try Again',
    },
    header: {
      unit: 'Unit of Measure:',
      trackingDate: 'Tracking Date:',
      shift: 'Shift:',
      snapshot: 'Calculated from a real-time database snapshot',
    },
    status: {
      fulfilled: 'FULFILLED',
      inProduction: 'IN PRODUCTION',
      shortage: 'SHORTAGE',
    },
    summary: {
      demand: 'Demand',
      demandHint: 'Daily demand target',
      fgStock: 'Finish Good Stock',
      fgStockHint: 'Stock ready to ship in the warehouse',
      wip: 'Work In Progress',
      wipHint: 'Currently being produced on machines',
      gap: 'Gap Analysis',
      gapShortage: '⚠️ Below demand target',
      gapSafe: '✅ Safe to meet demand target',
    },
    chart: {
      title: 'Demand vs Supply Chart',
      noDemand:
        'No Demand target registered today. Available FG stock ({count} {unit}) is safe from shortage.',
      supplyProgress: 'Supply Progress (FG + WIP)',
      totalSupply: 'Total Supply: {supplied} / {demand} {unit} ({pct}%)',
      fgBarLabel: 'FG: {count}',
      wipBarLabel: 'WIP: {count}',
      target: 'Target',
      targetDemand: 'Target Demand',
      fgTooltip: 'FG Stock: {count} {unit}',
      wipTooltip: 'WIP: {count} {unit}',
      legendFg: 'Finished / Ready Stock (FG): {count} {unit}',
      legendWip: 'In Production (WIP): {count} {unit}',
      legendDemand: 'Target Line (Demand): {count} {unit}',
    },
    wipTable: {
      title: 'Active WIP Work Details',
      desc: 'Shows details of the workstations and capacity of this item currently in production.',
      registered: '{count} WIP Registered',
      empty: 'No active WIP activity for this item on the production line.',
      col: {
        workstation: 'Workstation / Location',
        shift: 'Shift',
        progress: 'WIP Progress',
        startDate: 'Start Date',
      },
    },
  },
};
