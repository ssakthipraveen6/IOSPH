/**
 * node_exporter_collector.js (Simulation)
 * 
 * Simulated Prometheus Node Exporter metrics for demo mode.
 */
module.exports = {
  collect: (simulations = {}, base = {}) => {
    const isOutage = simulations.node_exporter && simulations.node_exporter.type === 'outage';
    const isSpike = simulations.node_exporter && simulations.node_exporter.type === 'cpu_spike';

    return {
      active_node_exporters: isOutage ? 3 : 8,
      avg_cpu_idle: isOutage ? 12.5 : (isSpike ? 24.2 : parseFloat((82.5 + (Math.random() - 0.5) * 4).toFixed(1))),
      avg_cpu_iowait: isOutage ? 18.4 : parseFloat((1.2 + (Math.random() - 0.5) * 0.4).toFixed(2)),
      avg_cpu_steal: isOutage ? 4.2 : 0.1,
      avg_memory_available_pct: isOutage ? 14.8 : parseFloat((64.2 + (Math.random() - 0.5) * 3).toFixed(1)),
      avg_load_1m: isOutage ? 14.8 : (isSpike ? 8.4 : parseFloat((2.14 + (Math.random() - 0.5) * 0.3).toFixed(2))),
      avg_load_5m: isOutage ? 11.2 : (isSpike ? 6.2 : parseFloat((1.88 + (Math.random() - 0.5) * 0.2).toFixed(2))),
      avg_file_descriptors_used_pct: isOutage ? 78.4 : parseFloat((12.4 + (Math.random() - 0.5) * 1).toFixed(1)),
      avg_inode_used_pct: isOutage ? 88.2 : parseFloat((38.6 + (Math.random() - 0.5) * 2).toFixed(1)),
      total_tcp_sockets_timewait: isOutage ? 2840 : Math.floor(420 + (Math.random() - 0.5) * 40)
    };
  }
};
