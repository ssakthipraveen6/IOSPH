module.exports = {
  collect: (simulations, base) => {
    const winSim = simulations['windows_servers'];
    if (winSim && winSim.type === 'outage') {
      return { cpu: 0, memory: 0, disk: 0 };
    }
    
    return {
      cpu: parseFloat((base.cpu + (Math.random() - 0.5) * 8).toFixed(2)),
      memory: parseFloat((base.memory + (Math.random() - 0.5) * 3).toFixed(2)),
      disk: base.disk,
      fortify_cpu: parseFloat((base.fortify_cpu + (Math.random() - 0.5) * 2).toFixed(2)),
      fortify_mem: parseFloat((base.fortify_mem + (Math.random() - 0.5) * 0.5).toFixed(2)),
      iis_threads: base.iis_threads + Math.floor((Math.random() - 0.5) * 10),
      iis_sessions: base.iis_sessions + Math.floor((Math.random() - 0.5) * 20)
    };
  }
};
