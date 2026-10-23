// Simulation state manager for Intelligent Observability & Autonomous Recovery Framework
let activeSimulations = {};

// Active fault simulations by component.
function getSimulations() {
  return activeSimulations;
}

// Starts or clears a fault simulation for a component.
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

// Clears every simulation.
function clearAllSimulations() {
  activeSimulations = {};
}

module.exports = {
  getSimulations,
  triggerSimulation,
  clearAllSimulations
};
