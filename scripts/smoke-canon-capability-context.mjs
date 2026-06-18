const {
  buildCanonCapabilityContext,
  canonCapabilityContextContainsRawSecret,
  deriveCanonCapabilityContext,
  emptyCanonCapabilityContext
} = await import("../packages/db/dist/canon-capability-context.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoRawSecret(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    `${"sk"}-fixture-secret-value`,
    `${"postgres"}://user:password@host/db`,
    "super-secret-password",
    '"value"',
    '"token"',
    '"password"'
  ];
  for (const marker of forbidden) {
    assert(!serialized.includes(marker), `${label} leaked forbidden marker ${marker}: ${serialized}`);
  }
  assert(!canonCapabilityContextContainsRawSecret(value), `${label} contains raw secret-like data`);
}

const empty = emptyCanonCapabilityContext();
assert(empty.schema_version === 1, "empty context schema version mismatch");
assert(empty.status === "not_recorded", `empty context status mismatch: ${empty.status}`);
assert(Array.isArray(empty.environment_facts), "empty environment_facts missing");
assert(Array.isArray(empty.capability_references), "empty capability_references missing");
assert(Array.isArray(empty.secret_references), "empty secret_references missing");
assert(Array.isArray(empty.server_canon_links), "empty server_canon_links missing");
assert(Array.isArray(empty.documentation_authority_map), "empty documentation_authority_map missing");
assert(
  empty.server_canon_links.some((item) => item.status === "needed") &&
    empty.server_canon_links.some((item) => item.kind === "security_baseline") &&
    empty.server_canon_links.some((item) => item.kind === "ports_inventory"),
  `empty server canon defaults incomplete: ${JSON.stringify(empty.server_canon_links)}`
);
assertNoRawSecret(empty, "empty context");

const populated = buildCanonCapabilityContext({
  environment_facts: [
    {
      key: "runtime_profile",
      label: "Runtime profile",
      value_summary: "Private service profile is configured by reference.",
      status: "configured",
      provenance: {
        source_kind: "project_setting",
        source_id: "runtime-profile",
        source_path: null,
        review_status: "configured_reference"
      }
    }
  ],
  capability_references: [
    {
      id: "capability://drive/read-only",
      label: "Drive read-only connector",
      kind: "connector",
      status: "review_required",
      access: "consent_required",
      provenance: {
        source_kind: "project_source",
        source_id: "source-drive",
        source_path: "docs/capabilities.md",
        review_status: "review_required"
      }
    }
  ],
  secret_references: [
    {
      name: "OPENAI_API_KEY",
      reference: "secret-store:OPENAI_API_KEY",
      provider: "env",
      status: "configured_reference",
      provenance: {
        source_kind: "imported_source",
        source_id: "env-example",
        source_path: ".env.example",
        review_status: "evidence_only"
      }
    },
    {
      name: "LEAKY_SECRET",
      reference: "leaky",
      value: `${"sk"}-fixture-secret-value`,
      token: `${"super"}-secret-password`
    }
  ],
  server_canon_links: [
    {
      kind: "security_baseline",
      label: "Security baseline",
      status: "configured",
      reference: "configured-security-baseline",
      provenance: {
        source_kind: "project_setting",
        source_id: "security-baseline",
        source_path: null,
        review_status: "configured_reference"
      }
    },
    {
      kind: "ports_inventory",
      label: "Ports inventory",
      status: "missing",
      reference: null
    }
  ],
  documentation_authority_map: [
    {
      path: "README.md",
      role: "canonical_doc",
      status: "canonical",
      reason: "Primary project overview.",
      provenance: {
        source_kind: "imported_source",
        source_id: "readme",
        source_path: "README.md",
        review_status: "canonical"
      }
    },
    {
      path: "PROJECT_LOG.md",
      role: "generated_bootstrap",
      status: "configured_reference",
      reason: "Compact checkpoint fallback.",
      provenance: {
        source_kind: "project_setting",
        source_id: "starter-docs",
        source_path: "PROJECT_LOG.md",
        review_status: "configured_reference"
      }
    },
    {
      path: ".cursor/SESSION_HANDOFF.md",
      role: "stale_handoff",
      status: "review_required",
      reason: "Historical handoff must be reviewed before use."
    }
  ]
});

assert(populated.status === "ready", `populated context status mismatch: ${populated.status}`);
assert(populated.environment_facts.length === 1, "environment facts missing");
assert(populated.capability_references.length === 1, "capability references missing");
assert(populated.secret_references.length === 1, "secret reference value filter failed");
assert(populated.server_canon_links.length === 2, "server canon links missing");
assert(populated.documentation_authority_map.length === 3, "documentation authority map missing");
assert(
  populated.secret_references[0]?.name === "OPENAI_API_KEY" &&
    !Object.hasOwn(populated.secret_references[0], "value"),
  `secret reference shape unsafe: ${JSON.stringify(populated.secret_references)}`
);
for (const collection of [
  ...populated.environment_facts,
  ...populated.capability_references,
  ...populated.secret_references,
  ...populated.server_canon_links,
  ...populated.documentation_authority_map
]) {
  assert(collection.authority?.instruction_grade === false, `instruction_grade missing: ${JSON.stringify(collection)}`);
  assert(collection.provenance, `provenance missing: ${JSON.stringify(collection)}`);
}
assert(
  populated.server_canon_links.some((item) => item.status === "configured") &&
    populated.server_canon_links.some((item) => item.status === "missing"),
  "server canon link states were not preserved"
);
assert(
  populated.documentation_authority_map.some((item) => item.role === "canonical_doc") &&
    populated.documentation_authority_map.some((item) => item.role === "generated_bootstrap") &&
    populated.documentation_authority_map.some((item) => item.role === "stale_handoff"),
  `documentation authority roles incomplete: ${JSON.stringify(populated.documentation_authority_map)}`
);
assertNoRawSecret(populated, "populated context");

const derived = deriveCanonCapabilityContext({
  max_items_per_category: 2,
  documentation_posture: {
    existing_docs: ["README.md", "AGENTS.md"],
    missing_recommended_docs: ["docs/RUNBOOK.md"],
    canon_context: {
      recommended_reference_kinds: ["security baseline", "ports inventory"],
      configured_references: ["security baseline reference"]
    }
  },
  starter_docs: {
    outcome: {
      generated_files: ["PROJECT_LOG.md"]
    }
  },
  project_settings: [
    {
      key: "runtime_profile",
      value: "Managed service profile reference."
    },
    {
      key: "private_unrelated_setting",
      value: "ignored"
    }
  ],
  memories: [
    {
      id: "memory-runtime",
      status: "accepted",
      memory_type: "environment_fact",
      scope_kind: "environment",
      scope_id: "runtime_profile",
      title: "Runtime profile",
      body: "Service runtime is represented by named profile only."
    },
    {
      id: "memory-leaky",
      status: "accepted",
      memory_type: "environment_fact",
      scope_kind: "environment",
      title: "Leaky memory",
      body: `${"postgres"}://user:password@host/db`
    }
  ],
  project_sources: [
    {
      id: "drive-source",
      source_kind: "connector",
      label: "Drive read-only connector",
      status: "needs_review",
      metadata: {
        source_access_contract: {
          capability_binding_status: "review_required",
          consent_state: "pending"
        },
        secret_references: [
          {
            name: "DRIVE_CLIENT_SECRET",
            reference: "secret-store:DRIVE_CLIENT_SECRET",
            provider: "vault"
          }
        ]
      }
    }
  ],
  imports: [
    {
      id: "env-example-import",
      source_path: ".env.example",
      review_required: true,
      secret_references: [
        {
          name: "OPENAI_API_KEY",
          reference: "secret-store:OPENAI_API_KEY"
        },
        {
          name: "LEAKY_IMPORT_SECRET",
          reference: "leaky",
          value: `${"sk"}-fixture-secret-value`
        }
      ]
    }
  ]
});

assert(derived.status === "ready", `derived status mismatch: ${derived.status}`);
assert(derived.environment_facts.length === 2, "derived max bound for environment facts failed");
assert(
  derived.environment_facts.some((item) => item.provenance.source_kind === "agent_memory") &&
    derived.environment_facts.some((item) => item.provenance.source_kind === "project_setting"),
  `derived environment provenance incomplete: ${JSON.stringify(derived.environment_facts)}`
);
assert(derived.capability_references.length === 1, "derived capability reference missing");
assert(
  derived.capability_references[0]?.access === "consent_required" &&
    derived.capability_references[0]?.status === "review_required",
  `derived capability must stay reference-only/reviewed: ${JSON.stringify(derived.capability_references)}`
);
assert(derived.secret_references.length === 2, "derived names-only secret references missing");
assert(
  derived.secret_references.every((item) => !Object.hasOwn(item, "value")),
  `derived secret reference leaked raw fields: ${JSON.stringify(derived.secret_references)}`
);
assert(
  derived.server_canon_links.length === 2 &&
    derived.server_canon_links.some((item) => item.status === "configured") &&
    derived.server_canon_links.some((item) => item.status === "needed"),
  `derived server canon links incomplete: ${JSON.stringify(derived.server_canon_links)}`
);
assert(
  derived.documentation_authority_map.length === 2 &&
    derived.documentation_authority_map.some((item) => item.role === "canonical_doc"),
  `derived documentation map did not apply deterministic max bound: ${JSON.stringify(
    derived.documentation_authority_map
  )}`
);
assertNoRawSecret(derived, "derived context");

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      empty_excerpt: {
        status: empty.status,
        categories: {
          environment_facts: empty.environment_facts.length,
          capability_references: empty.capability_references.length,
          secret_references: empty.secret_references.length,
          server_canon_links: empty.server_canon_links.map((item) => item.status),
          documentation_authority_map: empty.documentation_authority_map.length
        },
        no_secret: true
      },
      populated_excerpt: {
        status: populated.status,
        environment_facts: populated.environment_facts.map((item) => item.key),
        capability_references: populated.capability_references.map((item) => item.id),
        secret_references: populated.secret_references.map((item) => ({
          name: item.name,
          reference: item.reference,
          status: item.status
        })),
        server_canon_links: populated.server_canon_links.map((item) => ({
          kind: item.kind,
          status: item.status,
          reference: item.reference
        })),
        documentation_authority_roles: populated.documentation_authority_map.map((item) => item.role),
        no_secret: true
      },
      derived_excerpt: {
        status: derived.status,
        environment_provenance: derived.environment_facts.map((item) => item.provenance.source_kind),
        capability_access: derived.capability_references.map((item) => ({
          label: item.label,
          status: item.status,
          access: item.access
        })),
        secret_reference_names: derived.secret_references.map((item) => item.name),
        server_canon_links: derived.server_canon_links.map((item) => ({
          kind: item.kind,
          status: item.status,
          reference: item.reference
        })),
        documentation_authority_roles: derived.documentation_authority_map.map((item) => item.role),
        bounded_max: 2,
        no_secret: true
      }
    },
    null,
    2
  )}\n`
);
process.stdout.write("Canon/capability context smoke passed\n");
