-- 001_create_entity_schema.sql
-- Phase 1: Entity model and inventory schema

CREATE TABLE IF NOT EXISTS entity (
  entity_id    TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,      -- app|oc|controller|agent|host|db|avi|k8s_cluster|k8s_node|storage|url|service|sensor
  name         TEXT NOT NULL,
  app_id       TEXT,
  region       TEXT,               -- emea|apac|amer
  environment  TEXT NOT NULL,      -- prod|staging|demo
  parent_id    TEXT REFERENCES entity(entity_id),
  labels       JSONB NOT NULL DEFAULT '{}',
  source       TEXT NOT NULL,      -- yaml|otlp|jenkins_api|teamcity_api|k8s_api|avi_api
  status       TEXT,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_app_env ON entity (app_id, environment);
CREATE INDEX IF NOT EXISTS idx_entity_kind_region_env ON entity (kind, region, environment);
CREATE INDEX IF NOT EXISTS idx_entity_parent_id ON entity (parent_id);

CREATE TABLE IF NOT EXISTS entity_edge (
  from_entity TEXT NOT NULL REFERENCES entity(entity_id) ON DELETE CASCADE,
  to_entity   TEXT NOT NULL REFERENCES entity(entity_id) ON DELETE CASCADE,
  edge_type   TEXT NOT NULL,       -- runs_on|routes_through|stores_on|member_of|depends_on|resolves_to|scanned_by
  confidence  REAL NOT NULL DEFAULT 1.0,
  source      TEXT NOT NULL,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_entity, to_entity, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_entity_edge_to_type ON entity_edge (to_entity, edge_type);
