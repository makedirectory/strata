"use client";
import React, { createContext, useContext, useRef, useState } from "react";
import type { FlowEdge, FlowNode, NodeType, Pan, PaletteItem } from "../types";

// ---------- Palette ----------
const PALETTE: PaletteItem[] = [
  { type: "VPC", color: "var(--accent)", defaults: { name: "VPC", cidr: "10.0.0.0/16" } },
  { type: "Subnet (Public)", color: "var(--accent)", defaults: { name: "Public Subnet", cidr: "10.0.1.0/24", public: true } },
  { type: "Subnet (Private)", color: "var(--accent)", defaults: { name: "Private Subnet", cidr: "10.0.2.0/24", public: false } },
  { type: "Route Table", color: "var(--accent)", defaults: { name: "Route Table" } },
  { type: "NACL", color: "var(--accent)", defaults: { name: "NACL" } },
  { type: "Internet Gateway", color: "var(--yellow)", defaults: { name: "IGW" } },
  { type: "NAT Gateway", color: "var(--yellow)", defaults: { name: "NAT GW" } },
  { type: "ECS Cluster", color: "var(--accent-2)", defaults: { name: "ECS Cluster" } },
  { type: "ECS Service", color: "var(--accent-2)", defaults: { name: "Service", notes: "port 80" } },
  { type: "EC2", color: "var(--accent-2)", defaults: { name: "EC2" } },
  { type: "ALB", color: "var(--yellow)", defaults: { name: "ALB" } },
  { type: "Target Group", color: "var(--yellow)", defaults: { name: "Target Group" } },
  { type: "Security Group", color: "var(--yellow)", defaults: { name: "SG" } },
  { type: "RDS", color: "var(--green)", defaults: { name: "RDS" } },
  { type: "S3", color: "var(--green)", defaults: { name: "S3 Bucket" } },
  { type: "ECR", color: "var(--green)", defaults: { name: "ECR" } },
  { type: "CloudWatch", color: "var(--blue)", defaults: { name: "CloudWatch" } },
  { type: "IAM Role", color: "var(--blue)", defaults: { name: "IAM Role" } }
];

// ---------- Context ----------
interface SelectionNode { type: "node"; id: string; node: FlowNode }
interface SelectionEdge { type: "edge"; id: string; edge: FlowEdge; edgeFromTo: { fromName: string; toName: string } }

interface FlowContextValue {
  PALETTE: PaletteItem[];
  state: { nodes: FlowNode[]; edges: FlowEdge[]; pan: Pan; mode: "move"|"connect"; nextId: number };
  worldRef: React.RefObject<HTMLDivElement>;
  svgRef: React.RefObject<SVGSVGElement>;
  minimapRef: React.RefObject<HTMLCanvasElement>;
  selection: SelectionNode | SelectionEdge | null;
  status: string;

  // actions
  setMode: (m: "move"|"connect") => void;
  toggleMode: () => void;
  select: (sel: FlowContextValue["selection"]) => void;
  addNode: (type: NodeType, x: number, y: number, props?: Partial<FlowNode["props"]>) => void;
  addNodeFromPalette: (item: PaletteItem, client: { x: number; y: number }) => void;
  removeSelection: () => void;
  duplicateSelection: () => void;
  groupIntoVPC: () => void;
  connect: (a: string, b: string, rel?: FlowEdge["rel"]) => void;
  updateInspectorFields: (patch: any) => void;

  // canvas interaction
  onNodeMouseDown: (e: React.MouseEvent, node: FlowNode) => void;
  onCanvasMouseDown: (e: React.MouseEvent) => void;
  onCanvasClick: () => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: () => void;
  onWheelZoom: (e: React.WheelEvent) => void;

  // draw
  draw: () => void;
  drawMinimap: () => void;
  fitToView: () => void;
  center: () => void;

  // logic
  validate: () => void;
  suggestRules: () => void;
  exportJSON: () => void;
  importJSONDialog: () => void;
  clear: () => void;

  // UI helper HTML strings
  runValidateUI: () => void;
  runRulesUI: () => void;
  validationHtml: string;
  rulesHtml: string;
}

const FlowContext = createContext<FlowContextValue>(null as any);
export const useFlow = () => useContext(FlowContext);

// ---------- Provider ----------
export const FlowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const worldRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);

  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [nextId, setNextId] = useState<number>(1);
  const [selection, setSelection] = useState<FlowContextValue["selection"]>(null);
  const [mode, setModeState] = useState<"move"|"connect">("move");
  const [pan, setPan] = useState<Pan>({ x: 200, y: 120, scale: 1 });
  const [status, setStatus] = useState("Pan with space ⎵ + drag. Connect mode: C.");
  const [validationHtml, setValidationHtml] = useState("");
  const [rulesHtml, setRulesHtml] = useState("");

  const uid = () => String((prevId => { setNextId(prevId + 1); return prevId; })(nextId));

  const screenToWorld = (pt: { x: number; y: number }) => ({ x: (pt.x - pan.x) / pan.scale, y: (pt.y - pan.y) / pan.scale });
  const nodeColor = (type: NodeType) => {
    if (/VPC|Subnet|Route|NACL|Gateway/i.test(type)) return "var(--accent)";
    if (/ECS|EC2/i.test(type)) return "var(--accent-2)";
    if (/ALB|Gateway|Security Group|Target Group/i.test(type)) return "var(--yellow)";
    if (/RDS|S3|ECR/i.test(type)) return "var(--green)";
    if (/CloudWatch|IAM/i.test(type)) return "var(--blue)";
    return "#8892b0";
  };

  const setMode = (m: "move"|"connect") => { setModeState(m); setStatus(m === "connect" ? "Connect mode: click source then target" : "Pan with space ⎵ + drag. Connect mode: C."); };
  const toggleMode = () => setMode(mode === "connect" ? "move" : "connect");

  const addNode = (type: NodeType, x: number, y: number, props: Partial<FlowNode["props"]> = {}) => {
    const id = uid();
    const node: FlowNode = { id, type, x, y, w: 200, h: 96, props: { name: `${props.name || type} ${id}`, cidr: props.cidr || "", public: !!props.public, az: props.az || "", notes: props.notes || "" } };
    setNodes(n => [...n, node]);
    setSelection({ type: "node", id, node });
  };

  const addNodeFromPalette = (item: PaletteItem, client: { x: number; y: number }) => {
    const wrap = (worldRef.current?.parentElement as HTMLElement).getBoundingClientRect();
    const pt = screenToWorld({ x: client.x + wrap.left, y: client.y + wrap.top });
    addNode(item.type, pt.x - 80, pt.y - 40, item.defaults || {});
  };

  const removeSelection = () => {
    if (!selection) return;
    if (selection.type === "node") {
      setNodes(ns => ns.filter(n => n.id !== selection.id));
      setEdges(es => es.filter(e => e.from !== selection.id && e.to !== selection.id));
    } else {
      setEdges(es => es.filter(e => e.id !== selection.id));
    }
    setSelection(null);
  };

  const duplicateSelection = () => {
    if (!selection || selection.type !== "node") return;
    const n = nodes.find(n => n.id === selection.id); if (!n) return;
    addNode(n.type, n.x + 24, n.y + 24, n.props);
  };

  const connect = (a: string, b: string, rel: FlowEdge["rel"] = "depends_on") => {
    if (a === b) return;
    const id = uid();
    setEdges(es => [...es, { id, from: a, to: b, rel }]);
    const edge = { id, from: a, to: b, rel } as FlowEdge;
    setSelection({ type: "edge", id, edge, edgeFromTo: { fromName: nameOf(a), toName: nameOf(b) } });
  };

  const nameOf = (id: string) => nodes.find(n => n.id === id)?.props.name + " (" + (nodes.find(n => n.id === id)?.type || id) + ")" || id;

  const updateInspectorFields = (patch: any) => {
    if (!selection) return;
    if (selection.type === "node") {
      setNodes(ns => ns.map(n => n.id === selection.id ? { ...n, props: { ...n.props, ...patch } } : n));
    } else if (selection.type === "edge" && patch.rel) {
      setEdges(es => es.map(e => e.id === selection.id ? { ...e, rel: patch.rel } : e));
    }
  };

  // ------- Interaction & drawing -------
  const dragRef = useRef<{ nodeId: string; dx: number; dy: number } | null>(null);
  const panningRef = useRef(false);
  const connectStartRef = useRef<string | null>(null);

  const select = (sel: FlowContextValue["selection"]) => {
    if (!sel) { setSelection(null); highlightSelection(); return; }
    if (sel.type === "node") {
      const node = nodes.find(n => n.id === sel.id);
      if (node) setSelection({ ...sel, node });
    } else if (sel.type === "edge") {
      const edge = edges.find(e => e.id === sel.id);
      if (edge) setSelection({ ...sel, edge, edgeFromTo: { fromName: nameOf(edge.from), toName: nameOf(edge.to) } });
    }
    highlightSelection();
  };

  const onNodeMouseDown = (e: React.MouseEvent, node: FlowNode) => {
    if (mode === "connect") {
      e.stopPropagation();
      if (connectStartRef.current && connectStartRef.current !== node.id) {
        connect(connectStartRef.current, node.id);
        connectStartRef.current = null; setMode("move");
        return;
      }
      connectStartRef.current = node.id; toast(`Connecting from ${node.props.name} → click a target`);
      return;
    }
    e.preventDefault(); e.stopPropagation();
    const startX = (e as any).clientX; const startY = (e as any).clientY;
    const dx = startX - (pan.x + node.x * pan.scale);
    const dy = startY - (pan.y + node.y * pan.scale);
    dragRef.current = { nodeId: node.id, dx, dy };
    select({ type: "node", id: node.id, node });
  };

  const onMouseMove = (e: MouseEvent) => {
    if (dragRef.current) {
      const n = nodes.find(n => n.id === dragRef.current!.nodeId); if (!n) return;
      const nx = ((e.clientX - pan.x - dragRef.current.dx) / pan.scale);
      const ny = ((e.clientY - pan.y - dragRef.current.dy) / pan.scale);
      setNodes(ns => ns.map(m => m.id === n.id ? { ...m, x: Math.round(nx / 4) * 4, y: Math.round(ny / 4) * 4 } : m));
      draw();
    } else if (panningRef.current) {
      setPan(p => ({ ...p, x: p.x + (e as any).movementX, y: p.y + (e as any).movementY }));
      draw();
    }
  };

  const onMouseUp = () => { dragRef.current = null; panningRef.current = false; };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    const isGrid = (e.target as HTMLElement).classList.contains("overlay") || (e.target as HTMLElement).classList.contains("grid");
    if (isGrid && (e.button === 1 || (e.buttons === 1 && (e.nativeEvent as any).getModifierState("Space")))) {
      panningRef.current = true; e.preventDefault(); return;
    }
    if (isGrid && e.button === 0) { panningRef.current = true; e.preventDefault(); return; }
  };

  const onCanvasClick = () => select(null);

  const onWheelZoom = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const scale = pan.scale * (e.deltaY < 0 ? 1.1 : 0.9);
      const clamped = Math.min(2.0, Math.max(0.4, scale));
      setPan(p => ({ ...p, scale: clamped }));
      draw();
    }
  };

  function highlightSelection() {
    const world = worldRef.current!;
    [...world.children].forEach((el) => {
      const id = (el as HTMLElement).dataset.id;
      if (!id) return;
      const active = selection && selection.type === "node" && selection.id === id;
      (el as HTMLElement).style.borderColor = active ? "#5fbef3" : "#24406b";
      (el as HTMLElement).style.boxShadow = active ? "0 4px 14px rgba(76,167,255,.35)" : "0 2px 10px rgba(0,0,0,.35)";
    });
    const svg = svgRef.current!;
    [...svg.querySelectorAll("path")] .forEach((p: any) => {
      const id = p.getAttribute("data-id");
      const active = selection && selection.type === "edge" && selection.id === id;
      p.setAttribute("stroke", active ? "#5fbef3" : "#3baed3");
      p.setAttribute("stroke-width", active ? "3" : "2");
    });
  }

  function draw() {
    const world = worldRef.current!;
    const svg = svgRef.current!;
    (world as HTMLElement).style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`;
    (svg as HTMLElement).style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`;

    world.innerHTML = "";
    nodes.forEach((n) => {
      const div = document.createElement("div");
      div.className = "node";
      div.style.left = n.x + "px";
      div.style.top = n.y + "px";
      div.style.width = n.w + "px";
      div.style.height = n.h + "px";
      (div as any).dataset.id = n.id;

      const header = document.createElement("div");
      header.className = "node-header";
      header.innerHTML = `<div class="node-title">${n.props.name}</div><span class="badge" style="border-color:${nodeColor(n.type)}; color:${nodeColor(n.type)}">${n.type}</span>`;
      div.appendChild(header);

      const body = document.createElement("div");
      body.className = "node-body";
      const pills: string[] = [];
      if (n.props.cidr) pills.push(`<span class="pill"><span class="port" title="connect" data-port="out"></span>CIDR ${n.props.cidr}</span>`);
      if (typeof n.props.public !== "undefined") pills.push(`<span class="pill">${n.props.public ? "Public" : "Private"}</span>`);
      if (n.props.az) pills.push(`<span class="pill">${n.props.az}</span>`);
      body.innerHTML = pills.join(" ");
      const portIn = document.createElement("span"); portIn.className = "port"; (portIn as any).dataset.port = "in"; (portIn as HTMLElement).style.marginRight = "8px";
      body.prepend(portIn);
      div.appendChild(body);

      div.addEventListener("mousedown", (e) => onNodeMouseDown(e as any, n));
      div.addEventListener("click", (e) => { e.stopPropagation(); select({ type: "node", id: n.id, node: n }); });
      div.addEventListener("dblclick", (e) => { e.stopPropagation(); const newName = window.prompt("Rename node", n.props.name); if (newName !== null) { setNodes(ns => ns.map(x => x.id === n.id ? { ...x, props: { ...x.props, name: newName } } : x)); draw(); } });

      world.appendChild(div);
    });

    svg.innerHTML = "";
    edges.forEach((edge) => {
      const a = nodes.find(n => n.id === edge.from);
      const b = nodes.find(n => n.id === edge.to);
      if (!a || !b) return;
      const p1 = { x: a.x + a.w, y: a.y + a.h / 2 };
      const p2 = { x: b.x, y: b.y + b.h / 2 };
      const dx = Math.max(40, Math.abs(p2.x - p1.x) / 2);
      const d = `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "edge");
      path.setAttribute("data-id", edge.id);
      path.addEventListener("click", (e: any) => { e.stopPropagation(); select({ type: "edge", id: edge.id, edge, edgeFromTo: { fromName: nameOf(edge.from), toName: nameOf(edge.to) } }); });

      const midx = (p1.x + p2.x) / 2; const midy = (p1.y + p2.y) / 2;
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(midx));
      label.setAttribute("y", String(midy - 6));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "10");
      label.setAttribute("fill", "#cfe7ff");
      label.textContent = edge.rel;

      svg.appendChild(path);
      svg.appendChild(label);
    });
  }

  function drawMinimap() {
    const canvas = minimapRef.current!; if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width = 180; const h = canvas.height = 120;
    ctx.fillStyle = "#0a1020"; ctx.fillRect(0, 0, w, h);
    if (nodes.length === 0) return;
    const xs = nodes.map(n => n.x); const ys = nodes.map(n => n.y);
    const xe = nodes.map(n => n.x + n.w); const ye = nodes.map(n => n.y + n.h);
    const minx = Math.min(...xs); const miny = Math.min(...ys); const maxx = Math.max(...xe); const maxy = Math.max(...ye);
    const bw = maxx - minx; const bh = maxy - miny; const scale = Math.min((w - 10) / Math.max(1, bw), (h - 10) / Math.max(1, bh));
    ctx.save(); ctx.translate(5, 5); ctx.scale(scale, scale); ctx.translate(-minx, -miny);
    ctx.strokeStyle = "#36527e"; ctx.fillStyle = "#14254a";
    nodes.forEach(n => { ctx.fillRect(n.x, n.y, n.w, n.h); ctx.strokeRect(n.x, n.y, n.w, n.h); });
    ctx.restore();
  }

  function fitToView() {
    if (nodes.length === 0) { setPan({ x: 200, y: 120, scale: 1 }); draw(); return; }
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const xe = nodes.map(n => n.x + n.w), ye = nodes.map(n => n.y + n.h);
    const minx = Math.min(...xs), miny = Math.min(...ys), maxx = Math.max(...xe), maxy = Math.max(...ye);
    const worldW = maxx - minx, worldH = maxy - miny;
    const view = (worldRef.current!.parentElement as HTMLElement).getBoundingClientRect();
    const margin = 80;
    const sx = (view.width - margin * 2) / worldW;
    const sy = (view.height - margin * 2) / worldH;
    const scale = Math.max(0.4, Math.min(1.6, Math.min(sx, sy)));
    const centerX = (view.width - worldW * scale) / 2 - minx * scale;
    const centerY = (view.height - worldH * scale) / 2 - miny * scale;
    setPan({ x: centerX, y: centerY, scale }); draw();
  }
  function center() { setPan({ ...pan, x: 200, y: 120 }); draw(); }

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
    const ofType = (t: NodeType) => nodes.filter(n => n.type === t);
    const get = (id: string) => nodes.find(n => n.id === id);
    const incoming = (id: string, rel?: FlowEdge["rel"]) => edges.filter(e => e.to === id && (!rel || e.rel === rel));
    const outgoing = (id: string, rel?: FlowEdge["rel"]) => edges.filter(e => e.from === id && (!rel || e.rel === rel));

    nodes.filter(n => /Subnet/.test(n.type)).forEach(sn => {
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

    nodes.filter(n => /Subnet/.test(n.type) && n.props.public).forEach(sn => {
      const rt = incoming(sn.id, 'attached_to').map(e => get(e.from)).find(n => n && n.type === 'Route Table');
      const hasIGW = edges.some(e => rt && e.from === rt.id && e.rel === 'routes_to' && get(e.to)?.type === 'Internet Gateway');
      if (sn.props.public && (!rt || !hasIGW)) out.push(["error", `Public Subnet “${sn.props.name}” should have Route Table → routes_to → IGW.`]);
    });

    ofType('NAT Gateway').forEach(nat => {
      const subnet = incoming(nat.id, 'attached_to').map(e => get(e.from)).find(n => /Subnet/.test(n!.type));
      if (!subnet || !subnet.props.public) out.push(["error", `NAT Gateway should be placed in a public Subnet (attached_to).`]);
    });

    nodes.filter(n => /Subnet/.test(n.type) && !n.props.public).forEach(sn => {
      const rt = incoming(sn.id, 'attached_to').map(e => get(e.from)).find(n => n && n.type === 'Route Table');
      const hasNAT = edges.some(e => rt && e.from === rt.id && e.rel === 'routes_to' && get(e.to)?.type === 'NAT Gateway');
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
    const get = (id: string) => nodes.find(n => n.id === id)!;
    const incoming = (id: string, rel?: FlowEdge["rel"]) => edges.filter(e => e.to === id && (!rel || e.rel === rel));
    const outgoing = (id: string, rel?: FlowEdge["rel"]) => edges.filter(e => e.from === id && (!rel || e.rel === rel));

    const albs = nodes.filter(n => n.type === 'ALB');
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

    nodes.filter(n => /Subnet/.test(n.type) && !n.props.public).forEach(sn => {
      out.push({ scope: sn.props.name, type: 'Route Table', rules: [
        { route: '0.0.0.0/0', target: 'NAT Gateway', comment: 'Egress for private subnet' }
      ]});
    });

    nodes.filter(n => /Subnet/.test(n.type) && n.props.public).forEach(sn => {
      out.push({ scope: sn.props.name, type: 'Route Table', rules: [
        { route: '0.0.0.0/0', target: 'Internet Gateway', comment: 'Public internet access' }
      ]});
    });

    nodes.filter(n => n.type === 'NACL').forEach(nacl => {
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

  function exportJSON() {
    const data = { nodes, edges, pan, nextId };
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
          setNodes(data.nodes || []); setEdges(data.edges || []); setPan(data.pan || pan); setNextId(data.nextId || 1); setSelection(null); toast('Imported.'); draw();
        } catch { alert('Invalid JSON'); }
      };
      reader.readAsText(f);
    };
    input.click();
  }

  function clear() { if (confirm('Clear canvas?')) { setNodes([]); setEdges([]); setSelection(null); draw(); } }

  function toast(msg: string) {
    const el = document.querySelector('#toast') as HTMLElement; if (!el) return;
    el.textContent = msg; el.style.display = 'block';
    (toast as any)._t && clearTimeout((toast as any)._t);
    (toast as any)._t = setTimeout(() => { el.style.display = 'none'; }, 1600);
  }

  function seed() {
    const addSeed = (type: NodeType, x: number, y: number, props: any) => { const id = uid(); const node: FlowNode = { id, type, x, y, w: 200, h: 96, props: { name: props.name || type + ' ' + id, cidr: props.cidr || '', public: !!props.public, az: props.az || '', notes: props.notes || '' } }; setNodes(ns => [...ns, node]); return id; };
    const linkSeed = (a: string, b: string, rel: FlowEdge["rel"]) => { const id = uid(); setEdges(es => [...es, { id, from: a, to: b, rel }]); };

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

    setTimeout(() => { draw(); }, 0);
  }

  React.useEffect(() => { seed(); }, []);

  const validate = () => { validateInner(); };
  const suggestRules = () => { suggestRulesInner(); };
  const runValidateUI = () => validateInner();
  const runRulesUI = () => suggestRulesInner();

  const value: FlowContextValue = {
    PALETTE,
    state: { nodes, edges, pan, mode, nextId },
    worldRef, svgRef, minimapRef,
    selection, status,
    setMode, toggleMode, select,
    addNode, addNodeFromPalette, removeSelection, duplicateSelection, groupIntoVPC: () => {
      if (!selection || selection.type !== 'node') return;
      const n = nodes.find(x => x.id === selection.id); if (!n) return;
      addNode('VPC', n.x - 80, n.y - 80, { name: 'VPC', cidr: '10.0.0.0/16' });
    },
    connect, updateInspectorFields,
    onNodeMouseDown, onCanvasMouseDown, onCanvasClick, onMouseMove, onMouseUp, onWheelZoom,
    draw, drawMinimap, fitToView, center,
    validate, suggestRules, exportJSON, importJSONDialog, clear,
    runValidateUI, runRulesUI, validationHtml, rulesHtml
  };

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
};
