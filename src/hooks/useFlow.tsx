"use client";
import React, { createContext, useContext, useRef } from "react";
import { useFlowStore } from "./useFlowStore";
import type { FlowNode, FlowEdge, NodeType } from "../types";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { useCanvasRenderer } from "./useCanvasRenderer";

// ---------- Palette ----------
const PALETTE = [
  { type: "VPC" as NodeType, color: "var(--accent)", defaults: { name: "VPC", cidr: "10.0.0.0/16" } },
  { type: "Subnet (Public)" as NodeType, color: "var(--accent)", defaults: { name: "Public Subnet", cidr: "10.0.1.0/24", public: true } },
  { type: "Subnet (Private)" as NodeType, color: "var(--accent)", defaults: { name: "Private Subnet", cidr: "10.0.2.0/24", public: false } },
  { type: "Route Table" as NodeType, color: "var(--accent)", defaults: { name: "Route Table" } },
  { type: "NACL" as NodeType, color: "var(--accent)", defaults: { name: "NACL" } },
  { type: "Internet Gateway" as NodeType, color: "var(--yellow)", defaults: { name: "IGW" } },
  { type: "NAT Gateway" as NodeType, color: "var(--yellow)", defaults: { name: "NAT GW" } },
  { type: "ECS Cluster" as NodeType, color: "var(--accent-2)", defaults: { name: "ECS Cluster" } },
  { type: "ECS Service" as NodeType, color: "var(--accent-2)", defaults: { name: "Service", notes: "port 80" } },
  { type: "EC2" as NodeType, color: "var(--accent-2)", defaults: { name: "EC2" } },
  { type: "ALB" as NodeType, color: "var(--yellow)", defaults: { name: "ALB" } },
  { type: "Target Group" as NodeType, color: "var(--yellow)", defaults: { name: "Target Group" } },
  { type: "Security Group" as NodeType, color: "var(--yellow)", defaults: { name: "SG" } },
  { type: "RDS" as NodeType, color: "var(--green)", defaults: { name: "RDS" } },
  { type: "S3" as NodeType, color: "var(--green)", defaults: { name: "S3 Bucket" } },
  { type: "ECR" as NodeType, color: "var(--green)", defaults: { name: "ECR" } },
  { type: "CloudWatch" as NodeType, color: "var(--blue)", defaults: { name: "CloudWatch" } },
  { type: "IAM Role" as NodeType, color: "var(--blue)", defaults: { name: "IAM Role" } }
];

// ---------- Context Interface ----------
interface FlowContextValue {
  PALETTE: typeof PALETTE;
  state: {
    nodes: ReturnType<typeof useFlowStore>['nodes'];
    edges: ReturnType<typeof useFlowStore>['edges'];
    pan: ReturnType<typeof useFlowStore>['pan'];
    mode: ReturnType<typeof useFlowStore>['mode'];
    nextId: ReturnType<typeof useFlowStore>['nextId'];
  };
  worldRef: React.RefObject<HTMLDivElement>;
  svgRef: React.RefObject<SVGSVGElement>;
  minimapRef: React.RefObject<HTMLCanvasElement>;
  selection: ReturnType<typeof useFlowStore>['selection'];
  
  // Actions
  setMode: ReturnType<typeof useFlowStore>['setMode'];
  toggleMode: () => void;
  select: ReturnType<typeof useFlowStore>['setSelection'];
  addNode: ReturnType<typeof useFlowStore>['addNode'];
  addNodeFromPalette: (type: NodeType, x: number, y: number) => void;
  removeSelection: ReturnType<typeof useFlowStore>['removeSelection'];
  duplicateSelection: ReturnType<typeof useFlowStore>['duplicateSelection'];
  groupIntoVPC: () => void;
  connect: ReturnType<typeof useFlowStore>['connect'];
  updateInspectorFields: (patch: any) => void;

  // Canvas interaction
  onNodeMouseDown: (e: React.MouseEvent, node: any) => void;
  onCanvasMouseDown: (e: React.MouseEvent) => void;
  onCanvasClick: () => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: () => void;
  onWheelZoom: (e: React.WheelEvent) => void;
  setSpacePressed: (pressed: boolean) => void;
  screenToWorld: (pt: { x: number; y: number }) => { x: number; y: number };

  // Canvas rendering
  draw: () => void;
  drawMinimap: () => void;
  fitToView: () => void;
  center: () => void;

  // History
  undo: ReturnType<typeof useFlowStore>['undo'];
  redo: ReturnType<typeof useFlowStore>['redo'];

  // Placeholder functions (to be implemented)
  validate: () => void;
  suggestRules: () => void;
  exportJSON: () => void;
  importJSONDialog: () => void;
  clear: ReturnType<typeof useFlowStore>['clear'];
  loadPreset: (presetName: string) => void;
  runValidateUI: () => void;
  runRulesUI: () => void;
  validationHtml: string;
  rulesHtml: string;
  status: string;
}

const FlowContext = createContext<FlowContextValue>(null as any);
export const useFlow = () => useContext(FlowContext);

// ---------- Provider ----------
export const FlowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const worldRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);

  // Use our new hooks
  const store = useFlowStore();
  const interaction = useCanvasInteraction();
  const renderer = useCanvasRenderer(worldRef, svgRef, minimapRef);

  // Derived state
  const state = {
    nodes: store.nodes,
    edges: store.edges,
    pan: store.pan,
    mode: store.mode,
    nextId: store.nextId
  };

  // Helper functions
  const toggleMode = () => store.setMode(store.mode === "connect" ? "move" : "connect");
  
  const addNodeFromPalette = (type: NodeType, x: number, y: number) => {
    const paletteItem = PALETTE.find(p => p.type === type);
    const worldPos = interaction.screenToWorld({ x, y }, store.pan);
    store.addNode(type, worldPos.x, worldPos.y, paletteItem?.defaults || {});
  };

  const groupIntoVPC = () => {
    if (!store.selection || store.selection.type !== 'node') return;
    const n = store.nodes.find(x => x.id === store.selection?.id);
    if (!n) return;
    store.addNode('VPC', n.x - 80, n.y - 80, { name: 'VPC', cidr: '10.0.0.0/16' });
  };

  const updateInspectorFields = (patch: any) => {
    if (!store.selection) return;
    if (store.selection.type === "node") {
      store.updateNodeProps(store.selection.id, patch);
      // Update selection to reflect new node props
      const updatedNode = store.nodes.find(n => n.id === store.selection?.id);
      if (updatedNode) {
        store.setSelection({ type: "node", id: updatedNode.id, node: updatedNode });
      }
    } else if (store.selection.type === "edge" && patch.rel) {
      // TODO: Implement edge update in store
      console.log('Update edge rel:', patch.rel);
    }
  };

  // Canvas interaction handlers
  const onNodeMouseDown = (e: React.MouseEvent, node: any) => {
    interaction.onNodeMouseDown(e, node, store.pan, store.commitCurrentState);
    store.setSelection({ type: "node", id: node.id, node });
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    interaction.onCanvasMouseDown(e);
  };

  const onCanvasClick = () => {
    // Only deselect when clicking canvas background
    store.setSelection(null);
  };

  const onMouseMove = (e: MouseEvent) => {
    interaction.onMouseMove(e, store.nodes, store.pan, store.updateNode, store.setPan);
  };

  const onMouseUp = () => {
    interaction.onMouseUp(store.commitCurrentState);
  };

  const onWheelZoom = (e: React.WheelEvent) => {
    interaction.onWheelZoom(e, store.pan, store.setPan);
  };

  const screenToWorld = (pt: { x: number; y: number }) => {
    return interaction.screenToWorld(pt, store.pan);
  };

  // Canvas rendering
  const draw = () => {
    renderer.draw(
      store.nodes,
      store.edges,
      store.pan,
      store.selection,
      onNodeMouseDown,
      (nodeId: string, type: 'start' | 'end') => {
        interaction.onConnect(nodeId, type, store.connect);
      },
      store.setSelection
    );
  };

  const drawMinimap = () => {
    renderer.drawMinimap(store.nodes);
  };

  const fitToView = () => {
    interaction.fitToView(store.nodes, worldRef, store.setPan);
  };

  const center = () => {
    interaction.center(store.pan, store.setPan);
  };

  // Sidebar output state
  const [validationHtml, setValidationHtml] = React.useState<string>("");
  const [rulesHtml, setRulesHtml] = React.useState<string>("");

  function cidrContains(parent: string, child: string) {
    try {
      const [pBase, pMaskStr] = parent.split('/');
      const [cBase, cMaskStr] = child.split('/');
      const pMask = Number(pMaskStr), cMask = Number(cMaskStr);
      const toInt = (ip: string) => ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
      const pInt = toInt(pBase), cInt = toInt(cBase);
      const pNet = pInt & (~0 << (32 - pMask));
      const cNet = cInt & (~0 << (32 - cMask));
      return (cNet >>> 0) >= (pNet >>> 0) && (cNet >>> 0) <= ((pNet | ((1 << (32 - pMask)) - 1)) >>> 0);
    } catch { return true; }
  }

  function validateInner() {
    const out: Array<["error"|"warn"|"ok", string]> = [];
    const ofType = (t: NodeType) => store.nodes.filter(n => n.type === t);
    const get = (id: string) => store.nodes.find(n => n.id === id);
    const incoming = (id: string, rel?: FlowEdge["rel"]) => store.edges.filter(e => e.to === id && (!rel || e.rel === rel));
    const outgoing = (id: string, rel?: FlowEdge["rel"]) => store.edges.filter(e => e.from === id && (!rel || e.rel === rel));

    store.nodes.filter(n => /Subnet/.test(n.type)).forEach(sn => {
      const parentVPC = incoming(sn.id, 'attached_to').map(e => get(e.from)).find(n => n && n.type === 'VPC');
      if (!parentVPC) out.push(["error", `Subnet “${sn.props.name}” should be attached_to a VPC.`]);
      if (parentVPC && sn.props.cidr && parentVPC.props.cidr) {
        if (!cidrContains(parentVPC.props.cidr!, sn.props.cidr!)) out.push(["error", `Subnet ${sn.props.cidr} not inside VPC ${parentVPC.props.cidr}.`]);
      }
    });

    ofType('Route Table').forEach(rt => {
      const subs = outgoing(rt.id, 'attached_to').map(e => get(e.to)).filter(n => /Subnet/.test(n!.type));
      if (subs.length === 0) out.push(["warn", `Route Table “${rt.props.name}” is not attached_to any Subnet.`]);
    });

    ofType('NACL').forEach(nacl => {
      const subs = outgoing(nacl.id, 'attached_to').map(e => get(e.to)).filter(n => /Subnet/.test(n!.type));
      if (subs.length === 0) out.push(["warn", `NACL “${nacl.props.name}” is not attached_to any Subnet.`]);
    });

    ofType('Internet Gateway').forEach(igw => {
      const vpc = outgoing(igw.id, 'attached_to').map(e => get(e.to)).find(n => n && n.type === 'VPC');
      if (!vpc) out.push(["error", `IGW “${igw.props.name}” must be attached_to a VPC.`]);
    });

    store.nodes.filter(n => /Subnet/.test(n.type) && n.props.public).forEach(sn => {
      const rt = incoming(sn.id, 'attached_to').map(e => get(e.from)).find(n => n && n.type === 'Route Table');
      const hasIGW = store.edges.some(e => rt && e.from === rt.id && e.rel === 'routes_to' && get(e.to)?.type === 'Internet Gateway');
      if (sn.props.public && (!rt || !hasIGW)) out.push(["error", `Public Subnet “${sn.props.name}” should have Route Table → routes_to → IGW.`]);
    });

    ofType('NAT Gateway').forEach(nat => {
      const subnet = incoming(nat.id, 'attached_to').map(e => get(e.from)).find(n => /Subnet/.test(n!.type));
      if (!subnet || !subnet.props.public) out.push(["error", `NAT Gateway should be placed in a public Subnet (attached_to).`]);
    });

    store.nodes.filter(n => /Subnet/.test(n.type) && !n.props.public).forEach(sn => {
      const rt = incoming(sn.id, 'attached_to').map(e => get(e.from)).find(n => n && n.type === 'Route Table');
      const hasNAT = store.edges.some(e => rt && e.from === rt.id && e.rel === 'routes_to' && get(e.to)?.type === 'NAT Gateway');
      if (!rt || !hasNAT) out.push(["warn", `Private Subnet “${sn.props.name}” usually needs Route Table → routes_to → NAT GW for egress.`]);
    });

    ofType('ALB').forEach(alb => {
      const subs = incoming(alb.id, 'attached_to').map(e => get(e.from)).filter(n => /Subnet/.test(n!.type));
      const publicCount = subs.filter(s => s!.props.public).length;
      if (publicCount === 0) out.push(["warn", `ALB “${alb.props.name}” is not placed in any public Subnet (attach via attached_to).`]);
      const tg = outgoing(alb.id, 'targets').map(e => get(e.to)).find(n => n && n.type === 'Target Group');
      if (!tg) out.push(["warn", `ALB should targets a Target Group.`]);
    });

    ofType('Target Group').forEach(tg => {
      const target = outgoing(tg.id, 'targets').map(e => get(e.to)).find(n => n && /ECS Service|EC2/.test(n!.type));
      if (!target) out.push(["warn", `Target Group “${tg.props.name}” should targets an ECS Service or EC2.`]);
    });

    ofType('ECS Service').forEach(svc => {
      const subs = incoming(svc.id, 'attached_to').map(e => get(e.from)).filter(n => /Subnet/.test(n!.type));
      if (subs.length === 0) out.push(["error", `ECS Service “${svc.props.name}” must be attached_to Subnet(s).`]);
      const sg = incoming(svc.id, 'attached_to').map(e => get(e.from)).find(n => n && n.type === 'Security Group');
      if (!sg) out.push(["error", `ECS Service “${svc.props.name}” should be attached_to a Security Group.`]);
    });

    ofType('RDS').forEach(rds => {
      const subs = incoming(rds.id, 'attached_to').map(e => get(e.from)).filter(n => /Subnet/.test(n!.type));
      if (subs.length === 0) out.push(["warn", `RDS “${rds.props.name}” should be attached_to private Subnet(s).`]);
      subs.forEach(s => { if (s!.props.public) out.push(["warn", `RDS ideally not in public Subnet “${s!.props.name}”.`]); });
      const sg = incoming(rds.id, 'attached_to').map(e => get(e.from)).find(n => n && n.type === 'Security Group');
      if (!sg) out.push(["warn", `RDS should be attached_to a Security Group.`]);
    });

    const html = out.map(([level, msg]) => `<div class="mt-1">
      <span class="badge" style="border-color:${level === 'error' ? 'var(--danger)' : level === 'warn' ? 'var(--yellow)' : 'var(--green)'}; color:${level === 'error' ? 'var(--danger)' : level === 'warn' ? 'var(--yellow)' : 'var(--green)'}">${level}</span>
      <span class="ml-1">${msg}</span>
    </div>`).join('');
    setValidationHtml(html || '<span style="color:var(--green)">No issues found.</span>');
    return out;
  }

  function guessServicePort(svc: FlowNode) {
    const m = /port\s+(\d{2,5})/i.exec(svc.props.notes || '');
    return m ? m[1] : '80';
  }

  function suggestRulesInner() {
    const out: Array<{ scope: string; type: string; rules: any[] }> = [];
    const get = (id: string) => store.nodes.find(n => n.id === id)!;
    const incoming = (id: string, rel?: FlowEdge["rel"]) => store.edges.filter(e => e.to === id && (!rel || e.rel === rel));
    const outgoing = (id: string, rel?: FlowEdge["rel"]) => store.edges.filter(e => e.from === id && (!rel || e.rel === rel));

    const albs = store.nodes.filter(n => n.type === 'ALB');
    albs.forEach(alb => {
      out.push({ scope: alb.props.name, type: 'Security Group', rules: [
        { dir: 'ingress', proto: 'tcp', port: '80,443', src: '0.0.0.0/0', comment: 'Public HTTP/HTTPS to ALB' }
      ]});
      const tg = outgoing(alb.id, 'targets').map(e => get(e.to)).find(n => n && n.type === 'Target Group');
      const svc = tg ? outgoing(tg.id, 'targets').map(e => get(e.to)).find(n => n && /ECS Service|EC2/.test(n.type)) : null;
      if (svc) {
        const svcSg = incoming(svc.id, 'attached_to').map(e => get(e.from)).find(n => n && n.type === 'Security Group');
        if (svcSg) {
          out.push({ scope: svcSg.props.name, type: 'Security Group', rules: [
            { dir: 'ingress', proto: 'tcp', port: guessServicePort(svc), src: `sg:${alb.props.name}`, comment: 'ALB to Service' }
          ]});
        }
      }
    });

    store.nodes.filter(n => /Subnet/.test(n.type) && !n.props.public).forEach(sn => {
      out.push({ scope: sn.props.name, type: 'Route Table', rules: [
        { route: '0.0.0.0/0', target: 'NAT Gateway', comment: 'Egress for private subnet' }
      ]});
    });

    store.nodes.filter(n => /Subnet/.test(n.type) && n.props.public).forEach(sn => {
      out.push({ scope: sn.props.name, type: 'Route Table', rules: [
        { route: '0.0.0.0/0', target: 'Internet Gateway', comment: 'Public internet access' }
      ]});
    });

    store.nodes.filter(n => n.type === 'NACL').forEach(nacl => {
      out.push({ scope: nacl.props.name, type: 'NACL', rules: [
        { num: 100, dir: 'ingress', proto: 'tcp', port: '1024-65535', src: '0.0.0.0/0', allow: true, comment: 'Ephemeral return traffic' },
        { num: 110, dir: 'egress', proto: 'tcp', port: '0-65535', dst: '0.0.0.0/0', allow: true, comment: 'All egress' }
      ]});
    });

    const html = out.map(block => {
      const rows = (block.rules || []).map(r => `<li>${Object.entries(r).map(([k, v]) => `<span style=\"color:#9fb3c8\">${k}</span>: ${v}`).join(', ')}</li>`).join('');
      return `<div style=\"margin:6px 0 10px; padding:8px; border:1px solid #223055; border-radius:10px; background:#0d1831;\">
        <div style=\"font-weight:700;\">${block.type} — <span style=\"color:#a5b4fc\">${block.scope}</span></div>
        <ul style=\"margin:6px 0 0 16px;\">${rows}</ul>
      </div>`;
    }).join('');
    setRulesHtml(html || '<span style="color:var(--sub)">No suggestions yet—add ALB/Service, Subnets, NACLs…</span>');
  }

  const validate = () => { validateInner(); };
  const suggestRules = () => { suggestRulesInner(); };
  const runValidateUI = () => { validateInner(); };
  const runRulesUI = () => { suggestRulesInner(); };

  function exportJSON() {
    const data = { nodes: store.nodes, edges: store.edges, pan: store.pan, nextId: store.nextId };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'aws-flow.json'; a.click();
  }

  function importJSONDialog() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json';
    input.onchange = (e: any) => {
      const f = e.target.files?.[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          store.setNodes(data.nodes || []); store.setEdges(data.edges || []); store.setPan(data.pan || store.pan); store.nextId = data.nextId || 1; store.setSelection(null);
        } catch { alert('Invalid JSON'); }
      };
      reader.readAsText(f);
    };
    input.click();
  }
  function loadPreset(presetName: string) {
    if (presetName === "aws-basic") {
      loadBasicAWSSetup();
    } else if (presetName === "ecs-alb") {
      loadECSALBSetup();
    }
  }

  function loadBasicAWSSetup() {
    const newNodes: FlowNode[] = [];
    const newEdges: FlowEdge[] = [];
    const addSeed = (type: NodeType, x: number, y: number, props: any) => {
      const id = store.uid();
      const node: FlowNode = {
        id,
        type,
        x,
        y,
        w: 200,
        h: 96,
        props: {
          name: props.name || type + ' ' + id,
          cidr: props.cidr || '',
          public: !!props.public,
          az: props.az || '',
          notes: props.notes || ''
        }
      };
      newNodes.push(node);
      return id;
    };
    const linkSeed = (a: string, b: string, rel: FlowEdge["rel"]) => {
      const id = store.uid();
      newEdges.push({ id, from: a, to: b, rel });
    };

    const vpc = addSeed('VPC', 80, 120, { name: 'VPC', cidr: '10.0.0.0/16' });
    const pubA = addSeed('Subnet (Public)', 140, 220, { name: 'Public A', cidr: '10.0.1.0/24', public: true, az: 'us-east-1a' });
    const priA = addSeed('Subnet (Private)', 140, 360, { name: 'Private A', cidr: '10.0.2.0/24', public: false, az: 'us-east-1a' });
    const igw = addSeed('Internet Gateway', 420, 180, { name: 'IGW' });

    linkSeed(vpc, pubA, 'attached_to');
    linkSeed(vpc, priA, 'attached_to');
    linkSeed(igw, vpc, 'attached_to');

    store.setNodes(newNodes);
    store.setEdges(newEdges);
    store.setSelection(null);
    store.setPan({ x: 200, y: 120, scale: 1 });
  }

  function loadECSALBSetup() {
    const newNodes: FlowNode[] = [];
    const newEdges: FlowEdge[] = [];
    const addSeed = (type: NodeType, x: number, y: number, props: any) => {
      const id = store.uid();
      const node: FlowNode = {
        id,
        type,
        x,
        y,
        w: 200,
        h: 96,
        props: {
          name: props.name || type + ' ' + id,
          cidr: props.cidr || '',
          public: !!props.public,
          az: props.az || '',
          notes: props.notes || ''
        }
      };
      newNodes.push(node);
      return id;
    };
    const linkSeed = (a: string, b: string, rel: FlowEdge["rel"]) => {
      const id = store.uid();
      newEdges.push({ id, from: a, to: b, rel });
    };

    const vpc = addSeed('VPC', 80, 120, { name: 'VPC', cidr: '10.0.0.0/16' });
    const pubA = addSeed('Subnet (Public)', 140, 220, { name: 'Public A', cidr: '10.0.1.0/24', public: true, az: 'us-east-1a' });
    const priA = addSeed('Subnet (Private)', 140, 360, { name: 'Private A', cidr: '10.0.2.0/24', public: false, az: 'us-east-1a' });
    const igw = addSeed('Internet Gateway', 420, 180, { name: 'IGW' });
    const nat = addSeed('NAT Gateway', 420, 260, { name: 'NAT GW' });
    const rtp = addSeed('Route Table', 390, 340, { name: 'RT Private' });
    const rtpb = addSeed('Route Table', 390, 220, { name: 'RT Public' });
    const nacl = addSeed('NACL', 390, 420, { name: 'App NACL' });
    const alb = addSeed('ALB', 700, 200, { name: 'ALB' });
    const sgAlb = addSeed('Security Group', 620, 140, { name: 'SG-ALB' });
    const ecs = addSeed('ECS Service', 820, 340, { name: 'App Service', notes: 'port 3000' });
    const sgApp = addSeed('Security Group', 760, 300, { name: 'SG-App' });
    const tg = addSeed('Target Group', 760, 240, { name: 'TG-App' });

    linkSeed(vpc, pubA, 'attached_to'); linkSeed(vpc, priA, 'attached_to');
    linkSeed(igw, vpc, 'attached_to');
    linkSeed(nat, pubA, 'attached_to');
    linkSeed(rtpb, pubA, 'attached_to'); linkSeed(rtp, priA, 'attached_to');
    linkSeed(rtpb, igw, 'routes_to'); linkSeed(rtp, nat, 'routes_to');
    linkSeed(nacl, priA, 'attached_to');
    linkSeed(alb, pubA, 'attached_to');
    linkSeed(sgAlb, alb, 'attached_to');
    linkSeed(alb, tg, 'targets');
    linkSeed(tg, ecs, 'targets');
    linkSeed(sgApp, ecs, 'attached_to');

    store.setNodes(newNodes);
    store.setEdges(newEdges);
    store.setSelection(null);
    store.setPan({ x: 200, y: 120, scale: 1 });
  }

  const value: FlowContextValue = {
    PALETTE,
    state,
    worldRef,
    svgRef,
    minimapRef,
    selection: store.selection,

    // Actions
    setMode: store.setMode,
    toggleMode,
    select: store.setSelection,
    addNode: store.addNode,
    addNodeFromPalette,
    removeSelection: store.removeSelection,
    duplicateSelection: store.duplicateSelection,
    groupIntoVPC,
    connect: store.connect,
    updateInspectorFields,

    // Canvas interaction
    onNodeMouseDown,
    onCanvasMouseDown,
    onCanvasClick,
    onMouseMove,
    onMouseUp,
    onWheelZoom,
    setSpacePressed: interaction.setSpacePressed,
    screenToWorld,

    // Canvas rendering
    draw,
    drawMinimap,
    fitToView,
    center,

    // History
    undo: store.undo,
    redo: store.redo,

    // Placeholders
    validate,
    suggestRules,
    exportJSON,
    importJSONDialog,
    clear: store.clear,
    loadPreset,
    runValidateUI,
    runRulesUI,
  validationHtml,
  rulesHtml,
    status: "Pan with space ⎵ + drag. Connect mode: C."
  };

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
};