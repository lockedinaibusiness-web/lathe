/**
 * Initial schema. node-pg-migrate CommonJS migration (ADR-0004).
 * Times are unix epoch milliseconds (bigint) per ADR-0002.
 */
exports.up = (pgm) => {
  pgm.createTable(
    "projects",
    {
      id: { type: "text", primaryKey: true },
      title: { type: "text", notNull: true },
      status: { type: "text", notNull: true, default: "created" },
      timeline_version: { type: "integer", notNull: true, default: 1 },
      style_id: { type: "text" },
      created_ms: { type: "bigint", notNull: true },
      updated_ms: { type: "bigint", notNull: true },
    },
    { ifNotExists: true },
  );

  pgm.createTable(
    "timeline_versions",
    {
      project_id: { type: "text", notNull: true, references: "projects(id)" },
      version: { type: "integer", notNull: true },
      hash: { type: "text", notNull: true },
      timeline: { type: "jsonb", notNull: true },
      group_id: { type: "text" },
      created_ms: { type: "bigint", notNull: true },
    },
    { ifNotExists: true },
  );
  pgm.addConstraint(
    "timeline_versions",
    "timeline_versions_pk",
    "PRIMARY KEY (project_id, version)",
    { ifNotExists: true },
  );

  pgm.createTable(
    "assets",
    {
      id: { type: "text", primaryKey: true },
      project_id: { type: "text", notNull: true, references: "projects(id)" },
      filename: { type: "text", notNull: true },
      size_bytes: { type: "bigint", notNull: true },
      content_sha256: { type: "text" },
      status: { type: "text", notNull: true, default: "uploading" },
      meta: { type: "jsonb", notNull: true, default: "{}" },
      created_ms: { type: "bigint", notNull: true },
    },
    { ifNotExists: true },
  );

  pgm.createTable(
    "upload_sessions",
    {
      id: { type: "text", primaryKey: true },
      project_id: { type: "text", notNull: true, references: "projects(id)" },
      asset_id: { type: "text", notNull: true, references: "assets(id)" },
      total_bytes: { type: "bigint", notNull: true },
      chunk_size: { type: "integer", notNull: true },
      received: { type: "jsonb", notNull: true, default: "[]" },
      state: { type: "text", notNull: true, default: "open" },
      expires_ms: { type: "bigint", notNull: true },
      created_ms: { type: "bigint", notNull: true },
    },
    { ifNotExists: true },
  );

  pgm.createTable(
    "operation_groups",
    {
      id: { type: "text", primaryKey: true },
      project_id: { type: "text", notNull: true, references: "projects(id)" },
      actor: { type: "text", notNull: true },
      label: { type: "text" },
      rationale: { type: "text" },
      operations: { type: "jsonb", notNull: true },
      base_version: { type: "integer", notNull: true },
      resulting_version: { type: "integer", notNull: true },
      created_ms: { type: "bigint", notNull: true },
    },
    { ifNotExists: true },
  );
  pgm.createIndex("operation_groups", ["project_id", "created_ms"], { ifNotExists: true });

  pgm.createTable(
    "idempotency_keys",
    {
      key: { type: "text", notNull: true },
      scope: { type: "text", notNull: true },
      request_hash: { type: "text", notNull: true },
      response: { type: "jsonb", notNull: true },
      created_ms: { type: "bigint", notNull: true },
    },
    { ifNotExists: true },
  );
  pgm.addConstraint("idempotency_keys", "idempotency_keys_pk", "PRIMARY KEY (key, scope)", {
    ifNotExists: true,
  });

  pgm.createTable(
    "jobs",
    {
      id: { type: "text", primaryKey: true },
      type: { type: "text", notNull: true },
      project_id: { type: "text", references: "projects(id)" },
      asset_id: { type: "text", references: "assets(id)" },
      state: { type: "text", notNull: true, default: "queued" },
      progress: { type: "integer", notNull: true, default: 0 },
      stage: { type: "text" },
      payload: { type: "jsonb", notNull: true, default: "{}" },
      result: { type: "jsonb" },
      error: { type: "jsonb" },
      attempt: { type: "integer", notNull: true, default: 1 },
      created_ms: { type: "bigint", notNull: true },
      updated_ms: { type: "bigint", notNull: true },
    },
    { ifNotExists: true },
  );
  pgm.createIndex("jobs", ["project_id", "created_ms"], { ifNotExists: true });
};

exports.down = (pgm) => {
  pgm.dropTable("jobs", { ifExists: true });
  pgm.dropTable("idempotency_keys", { ifExists: true });
  pgm.dropTable("operation_groups", { ifExists: true });
  pgm.dropTable("upload_sessions", { ifExists: true });
  pgm.dropTable("assets", { ifExists: true });
  pgm.dropTable("timeline_versions", { ifExists: true });
  pgm.dropTable("projects", { ifExists: true });
};
