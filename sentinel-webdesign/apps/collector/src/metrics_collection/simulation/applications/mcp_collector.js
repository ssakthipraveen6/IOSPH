module.exports = {
  collect: (simulations, base) => {
    const mcpSim = simulations['mcp_server_k8s'];
    if (mcpSim && mcpSim.type === 'outage') {
      return { cpu: 0, latency: 10000, replicas: 0 };
    }
    
    return {
      cpu: parseFloat((base.cpu + (Math.random() - 0.5) * 4).toFixed(2)),
      latency: base.latency + Math.floor((Math.random() - 0.5) * 6),
      replicas: base.replicas
    };
  }
};
