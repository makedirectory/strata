"use client";
import React from "react";
import { useFlow } from "../hooks/useFlow";

export const Inspector: React.FC = () => {
  const { selection, updateInspectorFields, runValidateUI, runRulesUI, validationHtml, rulesHtml, removeSelection } = useFlow();
  // Use refs for Name and CIDR fields for smoother editing
  const nameRef = React.useRef<HTMLInputElement>(null);
  const cidrRef = React.useRef<HTMLInputElement>(null);
  
  if (!selection) {
    return (
      <div className="inspector">
        <div className="section">Select a node or edge to edit its properties.</div>
        <ValidationAndRules runValidateUI={runValidateUI} runRulesUI={runRulesUI} validationHtml={validationHtml} rulesHtml={rulesHtml} />
      </div>
    );
  }

  // Helper to update on blur or Enter
  const handleFieldUpdate = (field: string, ref: React.RefObject<HTMLInputElement>) => {
    if (!selection?.node) return;
    const value = ref.current?.value ?? "";
    updateInspectorFields({ [field]: value });
  };

  return (
    <div className="inspector">
      {selection?.type === "node" ? (
        <div className="section">
          <div className="kv">
            <div>Type</div><div id="insType">{selection.node?.type}</div>
            <div>Name</div>
            <div>
              <input
                id="insName"
                defaultValue={selection.node?.props.name || ""}
                ref={nameRef}
                onBlur={() => handleFieldUpdate("name", nameRef)}
                onKeyDown={e => { if (e.key === "Enter") { handleFieldUpdate("name", nameRef); nameRef.current?.blur(); } }}
              />
            </div>
            <div>CIDR (if net)</div>
            <div>
              <input
                id="insCidr"
                placeholder="10.0.0.0/16"
                defaultValue={selection.node?.props.cidr || ""}
                ref={cidrRef}
                onBlur={() => handleFieldUpdate("cidr", cidrRef)}
                onKeyDown={e => { if (e.key === "Enter") { handleFieldUpdate("cidr", cidrRef); cidrRef.current?.blur(); } }}
              />
            </div>
            <div>Public?</div><div><select id="insPublic" value={String(!!selection.node?.props.public)} onChange={(e)=>updateInspectorFields({ public: e.target.value === "true" })}><option value="false">No</option><option value="true">Yes</option></select></div>
            <div>AZ</div><div><input id="insAz" placeholder="us-east-1a" value={selection.node?.props.az || ""} onChange={(e)=>updateInspectorFields({ az: e.target.value })} /></div>
            <div>Notes</div><div><textarea id="insNotes" rows={3} value={selection.node?.props.notes || ""} onChange={(e)=>updateInspectorFields({ notes: e.target.value })} /></div>
          </div>
        </div>
      ) : (
        <div className="section">
          <div className="kv">
            <div>From</div><div>{selection.edgeFromTo?.fromName}</div>
            <div>To</div><div>{selection.edgeFromTo?.toName}</div>
            <div>Relationship</div>
            <div>
              <select id="edgeRel" value={selection.edge?.rel} onChange={(e)=>updateInspectorFields({ rel: e.target.value })}>
                <option value="depends_on">depends_on</option>
                <option value="attached_to">attached_to</option>
                <option value="routes_to">routes_to</option>
                <option value="allows">allows (SG/NACL)</option>
                <option value="targets">targets (ALB→Service)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <ValidationAndRules runValidateUI={runValidateUI} runRulesUI={runRulesUI} validationHtml={validationHtml} rulesHtml={rulesHtml} />
    </div>
  );
};

function ValidationAndRules({ runValidateUI, runRulesUI, validationHtml, rulesHtml }:{  runValidateUI: ()=>void; runRulesUI: ()=>void; validationHtml: string; rulesHtml: string;}){  return (    <>      <div className="section">        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>          <strong>Validation</strong>          <button onClick={runValidateUI} style={{ padding: "6px 10px" }}>Run</button>        </div>        <div id="validationOut" style={{ marginTop: 8, fontSize: 13 }} dangerouslySetInnerHTML={{ __html: validationHtml }} />      </div>      <div className="section">        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>          <strong>Rule Suggestions</strong>          <button onClick={runRulesUI} style={{ padding: "6px 10px" }}>Generate</button>        </div>        <div id="rulesOut" style={{ marginTop: 8, fontSize: 13 }} dangerouslySetInnerHTML={{ __html: rulesHtml }} />      </div>    </>  );}