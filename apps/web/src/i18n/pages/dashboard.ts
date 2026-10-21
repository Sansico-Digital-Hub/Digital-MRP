/**
 * Terjemahan halaman Dashboard (Production).
 * Namespace: `dashboard.*`
 */
export default {
  id: {
    loading: 'Memuat data dashboard...',
    loadError: 'Gagal memuat dashboard: {message}',
    searchPlaceholder: 'Filter berdasarkan Nomor Part / Nama Toy...',
    urgentActive: 'Item Mendesak (Hanya Kekurangan)',
    urgentInactive: 'Tampilkan Mendesak (Kekurangan)',
    summary: {
      filtered: 'Item Terfilter',
      fulfilled: 'Terpenuhi',
      inProduction: 'Dalam Produksi',
      shortage: 'Peringatan Kekurangan',
    },
    chart: {
      title: 'Analisis Kesenjangan Permintaan vs Pasokan',
      noData: 'Tidak ada data yang sesuai dengan filter aktif.',
      demand: 'Permintaan Harian',
      fgStock: 'Stok FG',
      wip: 'WIP',
    },
    urgent: {
      title: 'Detail Kekurangan Mendesak',
      count: '{count} item mengalami kekurangan',
      noData: 'Tidak ada detail kekurangan.',
      wipLocations: 'Lokasi WIP',
      table: {
        partNumber: 'Nomor Part',
        dailyDemand: 'Permintaan Harian',
        fgStock: 'Stok FG',
        dailyShortage: 'Kekurangan Harian',
        wip: 'WIP',
      },
    },
  },
  en: {
    loading: 'Loading dashboard data...',
    loadError: 'Error loading dashboard: {message}',
    searchPlaceholder: 'Filter by Part Number / Toy Name...',
    urgentActive: 'Urgent Items (Shortage Only)',
    urgentInactive: 'Show Urgent (Shortage)',
    summary: {
      filtered: 'Filtered Items',
      fulfilled: 'Fulfilled',
      inProduction: 'In Production',
      shortage: 'Shortage Alert',
    },
    chart: {
      title: 'Demand vs Supply Gap Analysis',
      noData: 'No data matching active filters.',
      demand: 'Daily Demand',
      fgStock: 'FG Stock',
      wip: 'WIP',
    },
    urgent: {
      title: 'Urgent Shortage Details',
      count: '{count} items with shortage',
      noData: 'No shortage details found.',
      wipLocations: 'WIP Locations',
      table: {
        partNumber: 'Part Number',
        dailyDemand: 'Daily Demand',
        fgStock: 'FG Stock',
        dailyShortage: 'Daily Shortage',
        wip: 'WIP',
      },
    },
  },
};
