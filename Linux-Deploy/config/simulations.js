// Simulation state manager for Intelligent Observability & Autonomous Recovery Framework
let activeSimulations = {};

function getSimulations() {
  return activeSimulations;
}

function triggerSimulation(component, type) {
  if (type === 'clear') {
    delete activeSimulations[component];
  } else {
    activeSimulations[component] = {
      type,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = {
  getSimulations,
  triggerSimulation
};
