"use client";
import React, { useId } from "react";
import { useFlow } from "../hooks/useFlow";
import { getService } from "../aws/registry";
import { REGIONS } from "../aws/regions";
import { RELATIONSHIPS, RELATIONSHIP_ORDER } from "../aws/categories";
import type { ConfigField, RelationshipKind } from "../aws/types";
import type { ResourceInstance } from "../aws/model";
import type { ValidationResult, RuleSuggestion } from "../aws/rules";

export const Inspector: React.FC = () => {
  const {
    selection,
    updateResourceField,
    updateRelationshipKind,
    runValidateUI,
    runRulesUI,
    validationResults,
    ruleSuggestions,
    presentation,
  } = useFlow();

  const validationAndRules = (
    <ValidationAndRules
      runValidateUI={runValidateUI}
      runRulesUI={runRulesUI}
      validationResults={validationResults}
      ruleSuggestions={ruleSuggestions}
    />
  );

  if (!selection) {
    return (
      <div className="inspector">
        <div className="section">Select a node or edge to edit its properties.</div>
        {validationAndRules}
      </div>
    );
  }

  if (selection.type === "node") {
    return (
      <div className="inspector">
        <NodeForm
          resource={selection.resource}
          onUpdate={updateResourceField}
          readOnly={presentation}
        />
        {validationAndRules}
      </div>
    );
  }

  return (
    <div className="inspector">
      <EdgeForm selection={selection} onUpdate={updateRelationshipKind} readOnly={presentation} />
      {validationAndRules}
    </div>
  );
};

const EdgeForm: React.FC<{
  selection: Extract<NonNullable<ReturnType<typeof useFlow>["selection"]>, { type: "edge" }>;
  onUpdate: (kind: RelationshipKind) => void;
  readOnly?: boolean;
}> = ({ selection, onUpdate, readOnly = false }) => {
  const relId = useId();
  return (
    <div className="section">
      <div className="kv">
        <div>From</div>
        <div>{selection.fromName}</div>
        <div>To</div>
        <div>{selection.toName}</div>
        <label htmlFor={relId}>Relationship</label>
        <div>
          <select
            id={relId}
            value={selection.relationship.kind}
            disabled={readOnly}
            onChange={(e) => onUpdate(e.target.value as RelationshipKind)}
          >
            {RELATIONSHIP_ORDER.map((k) => (
              <option key={k} value={k}>
                {RELATIONSHIPS[k].label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

const NodeForm: React.FC<{
  resource: ResourceInstance;
  onUpdate: (patch: { name?: string; region?: string; config?: Record<string, unknown> }) => void;
  readOnly?: boolean;
}> = ({ resource, onUpdate, readOnly = false }) => {
  const svc = getService(resource.serviceId);
  const baseId = useId();
  const nameId = `${baseId}-name`;
  const regionId = `${baseId}-region`;
  return (
    <div className="section">
      <div className="kv">
        <div>Service</div>
        <div>{svc?.fullName ?? resource.serviceId}</div>

        <label htmlFor={nameId}>Name</label>
        <div>
          <ControlledInput
            id={nameId}
            // Reset local edit state whenever a different resource is selected.
            resetKey={resource.id}
            value={resource.name}
            disabled={readOnly}
            commit={(v) => onUpdate({ name: v })}
          />
        </div>

        <label htmlFor={regionId}>Region</label>
        <div>
          <select
            id={regionId}
            value={resource.region ?? ""}
            disabled={readOnly}
            onChange={(e) => onUpdate({ region: e.target.value })}
          >
            <option value="">(none)</option>
            {REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {svc?.configFields.map((field) => {
          const fieldId = `${baseId}-${field.key}`;
          return (
            <React.Fragment key={field.key}>
              <label htmlFor={fieldId} title={field.help}>
                {field.label}
              </label>
              <div>
                <ConfigInput
                  id={fieldId}
                  resource={resource}
                  field={field}
                  onUpdate={onUpdate}
                  readOnly={readOnly}
                />
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Text input that mirrors the underlying value but lets the user edit freely
 * before committing on blur / Enter. Local state is re-synced whenever
 * `resetKey` changes (i.e. a different resource/field is selected), which avoids
 * the stale-value problem of an uncontrolled `defaultValue` input without
 * remounting on every parent render.
 */
const ControlledInput: React.FC<{
  id?: string;
  resetKey: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  commit: (value: string) => void;
}> = ({ id, resetKey, value, placeholder, disabled = false, commit }) => {
  const [draft, setDraft] = React.useState(value);
  const lastKeyRef = React.useRef(resetKey);

  // Re-sync when the selected entity changes (render-time, no effect needed).
  if (lastKeyRef.current !== resetKey) {
    lastKeyRef.current = resetKey;
    if (draft !== value) setDraft(value);
  }

  return (
    <input
      id={id}
      placeholder={placeholder}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
};

const ConfigInput: React.FC<{
  id?: string;
  resource: ResourceInstance;
  field: ConfigField;
  onUpdate: (patch: { config?: Record<string, unknown> }) => void;
  readOnly?: boolean;
}> = ({ id, resource, field, onUpdate, readOnly = false }) => {
  const value = resource.config[field.key];
  const setVal = (v: unknown) => onUpdate({ config: { [field.key]: v } });
  const resetKey = `${resource.id}-${field.key}`;

  switch (field.type) {
    case "boolean":
      return (
        <select
          id={id}
          value={value ? "true" : "false"}
          disabled={readOnly}
          onChange={(e) => setVal(e.target.value === "true")}
        >
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      );
    case "select":
      return (
        <select
          id={id}
          value={value === undefined ? "" : String(value)}
          disabled={readOnly}
          onChange={(e) => setVal(e.target.value)}
        >
          {!field.required && <option value="">(none)</option>}
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "multiselect":
    case "tags": {
      const text = Array.isArray(value)
        ? value.join(", ")
        : value === undefined
          ? ""
          : String(value);
      return (
        <ControlledInput
          id={id}
          resetKey={resetKey}
          value={text}
          placeholder={field.placeholder ?? "a, b, c"}
          disabled={readOnly}
          commit={(v) =>
            setVal(
              v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      );
    }
    case "text":
      return (
        <ControlledTextarea
          id={id}
          resetKey={resetKey}
          value={value === undefined ? "" : String(value)}
          placeholder={field.placeholder}
          disabled={readOnly}
          commit={(v) => setVal(v)}
        />
      );
    case "number":
      return (
        <ControlledInput
          id={id}
          resetKey={resetKey}
          value={value === undefined ? "" : String(value)}
          placeholder={field.placeholder}
          disabled={readOnly}
          commit={(v) => setVal(v === "" ? undefined : Number(v))}
        />
      );
    case "string":
    case "cidr":
    case "arn":
    default:
      return (
        <ControlledInput
          id={id}
          resetKey={resetKey}
          value={value === undefined ? "" : String(value)}
          placeholder={field.placeholder}
          disabled={readOnly}
          commit={(v) => setVal(v)}
        />
      );
  }
};

/** Multiline counterpart of {@link ControlledInput} for `text` config fields. */
const ControlledTextarea: React.FC<{
  id?: string;
  resetKey: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  commit: (value: string) => void;
}> = ({ id, resetKey, value, placeholder, disabled = false, commit }) => {
  const [draft, setDraft] = React.useState(value);
  const lastKeyRef = React.useRef(resetKey);

  if (lastKeyRef.current !== resetKey) {
    lastKeyRef.current = resetKey;
    if (draft !== value) setDraft(value);
  }

  return (
    <textarea
      id={id}
      rows={3}
      placeholder={placeholder}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
    />
  );
};

function levelColor(level: ValidationResult["level"]): string {
  return level === "error" ? "var(--danger)" : level === "warn" ? "var(--yellow)" : "var(--green)";
}

/**
 * Renders validation findings + rule suggestions as React elements built from
 * the STRUCTURED results returned by the rules engine. Node names and other
 * user-controlled text are rendered as plain text children (React escapes
 * them), so there is no HTML-injection / XSS surface here.
 */
function ValidationAndRules({
  runValidateUI,
  runRulesUI,
  validationResults,
  ruleSuggestions,
}: {
  runValidateUI: () => void;
  runRulesUI: () => void;
  validationResults: ValidationResult[] | null;
  ruleSuggestions: RuleSuggestion[] | null;
}) {
  return (
    <>
      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Validation</strong>
          <button onClick={runValidateUI} style={{ padding: "6px 10px" }}>
            Run
          </button>
        </div>
        <div id="validationOut" style={{ marginTop: 8, fontSize: 13 }}>
          {validationResults === null ? null : validationResults.length === 0 ? (
            <span style={{ color: "var(--green)" }}>No issues found.</span>
          ) : (
            validationResults.map((r, i) => (
              <div key={i} className="mt-1" style={{ marginTop: 4 }}>
                <span
                  className="badge"
                  style={{ borderColor: levelColor(r.level), color: levelColor(r.level) }}
                >
                  {r.level}
                </span>
                <span className="ml-1" style={{ marginLeft: 6 }}>
                  {r.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Rule Suggestions</strong>
          <button onClick={runRulesUI} style={{ padding: "6px 10px" }}>
            Generate
          </button>
        </div>
        <div id="rulesOut" style={{ marginTop: 8, fontSize: 13 }}>
          {ruleSuggestions === null ? null : ruleSuggestions.length === 0 ? (
            <span style={{ color: "var(--sub)" }}>
              No suggestions yet—add ALB/Service, Subnets, NACLs…
            </span>
          ) : (
            ruleSuggestions.map((block, i) => (
              <div
                key={i}
                style={{
                  margin: "6px 0 10px",
                  padding: 8,
                  border: "1px solid #223055",
                  borderRadius: 10,
                  background: "#0d1831",
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {block.type} — <span style={{ color: "#a5b4fc" }}>{block.scope}</span>
                </div>
                <ul style={{ margin: "6px 0 0 16px" }}>
                  {block.rules.map((rule, j) => (
                    <li key={j}>
                      {Object.entries(rule).map(([k, v], idx) => (
                        <React.Fragment key={k}>
                          {idx > 0 ? ", " : null}
                          <span style={{ color: "#9fb3c8" }}>{k}</span>: {String(v)}
                        </React.Fragment>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
