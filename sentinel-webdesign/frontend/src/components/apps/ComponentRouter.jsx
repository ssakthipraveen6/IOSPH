/**
 * Switches between the application map and a single component page.
 */
import React, { useState } from 'react';
import AppMapView from './AppMapView';
import ComponentPage from '../component/ComponentPage';

/**
 * ComponentRouter (Phase O5.2)
 * Manages view switching between Observe › Applications Map
 * and the unified ComponentPage for any clicked component.
 */
export default function ComponentRouter({
  environment = 'staging',
  initialAppId = 'bitbucket',
  initialComponent = null
}) {
  const [selectedComponent, setSelectedComponent] = useState(initialComponent);

  if (selectedComponent) {
    return (
      <ComponentPage
        kind={selectedComponent.kind}
        id={selectedComponent.id}
        environment={environment}
        onClose={() => setSelectedComponent(null)}
      />
    );
  }

  return (
    <AppMapView
      environment={environment}
      initialAppId={initialAppId}
      onSelectComponent={(comp) => setSelectedComponent(comp)}
    />
  );
}
