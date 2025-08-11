"use client";
import { useCallback, useEffect } from 'react';
import type { FlowNode, FlowEdge, Pan } from '../types';

export function useCanvasRenderer(
  worldRef: React.RefObject<HTMLDivElement>,
  svgRef: React.RefObject<SVGSVGElement>, 
  minimapRef: React.RefObject<HTMLCanvasElement>
) {
  
  const nodeColor = useCallback((type: string) => {
    if (/VPC|Subnet|Route|NACL|Gateway/i.test(type)) return "var(--accent)";
    if (/ECS|EC2/i.test(type)) return "var(--accent-2)";
    if (/ALB|Gateway|Security Group|Target Group/i.test(type)) return "var(--yellow)";
    if (/RDS|S3|ECR/i.test(type)) return "var(--green)";
    if (/CloudWatch|IAM/i.test(type)) return "var(--blue)";
    return "#8892b0";
  }, []);

  const draw = useCallback((
    nodes: FlowNode[], 
    edges: FlowEdge[], 
    pan: Pan, 
    selection: any,
    onNodeMouseDown: any,
    onConnect: any,
    onSelect: any
  ) => {
    const world = worldRef.current;
    const svg = svgRef.current;
    if (!world || !svg) return;

    // Transform world and svg
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`;
    svg.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`;

    // Clear world
    world.innerHTML = "";
    
    // Draw nodes
    nodes.forEach((n) => {
      try {
        const div = document.createElement("div");
        div.className = "node";
        div.style.left = n.x + "px";
        div.style.top = n.y + "px";
        div.style.width = n.w + "px";
        div.style.height = n.h + "px";
        (div as any).dataset.id = n.id;

        const header = document.createElement("div");
        header.className = "node-header";
        header.innerHTML = `<div class="node-title">${n.props.name}</div>`;
        
        const right = document.createElement('div');
        right.className = 'ports';
        
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.style.borderColor = nodeColor(n.type) as any;
        badge.style.color = nodeColor(n.type) as any;
        badge.textContent = n.type;
        
        const pOut = document.createElement('span');
        pOut.className = 'port port-out';
        pOut.title = 'Start connection';
        pOut.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          onConnect(n.id, 'start');
        });
        
        const pIn = document.createElement('span');
        pIn.className = 'port port-in';
        pIn.title = 'Finish connection';
        pIn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          onConnect(n.id, 'end');
        });
        
        right.appendChild(badge);
        right.appendChild(pOut);
        right.appendChild(pIn);
        header.appendChild(right);
        div.appendChild(header);

        const body = document.createElement("div");
        body.className = "node-body";
        
        // Add input port
        const portIn = document.createElement("span");
        portIn.className = "port";
        portIn.title = "connect";
        (portIn as any).dataset.port = "in";
        portIn.style.marginRight = "8px";
        body.appendChild(portIn);
        
        // Add pills for properties
        if (n.props.cidr) {
          const pillSpan = document.createElement("span");
          pillSpan.className = "pill";
          pillSpan.textContent = `CIDR ${n.props.cidr}`;
          body.appendChild(pillSpan);
        }
        
        if (typeof n.props.public !== "undefined") {
          const pillSpan = document.createElement("span");
          pillSpan.className = "pill";
          pillSpan.textContent = n.props.public ? "Public" : "Private";
          body.appendChild(pillSpan);
        }
        
        if (n.props.az) {
          const pillSpan = document.createElement("span");
          pillSpan.className = "pill";
          pillSpan.textContent = n.props.az;
          body.appendChild(pillSpan);
        }
        
        div.appendChild(body);

        div.addEventListener("mousedown", (e) => {
          if ((e.target as HTMLElement).closest('.port')) return;
          onNodeMouseDown(e as any, n);
          onSelect({ type: "node", id: n.id, node: n });
        });
        
        div.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          const newName = window.prompt("Rename node", n.props.name);
          if (newName !== null) {
            // This should call an update function passed from parent
            console.log('Rename node to:', newName);
          }
        });

        world.appendChild(div);
      } catch (err) {
        console.error('draw node failed', n, err);
      }
    });

    // Draw edges
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
      (path as any).style.pointerEvents = 'stroke';
      path.setAttribute("d", d);
      path.setAttribute("class", "edge");
      path.setAttribute("data-id", edge.id);
      path.addEventListener("click", (e: any) => {
        e.stopPropagation();
        onSelect({ type: "edge", id: edge.id, edge });
      });

      const midx = (p1.x + p2.x) / 2;
      const midy = (p1.y + p2.y) / 2;
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

    // Highlight selection
    if (selection) {
      const world = worldRef.current!;
      [...world.children].forEach((el) => {
        const id = (el as HTMLElement).dataset.id;
        if (!id) return;
        const active = selection && selection.type === "node" && selection.id === id;
        (el as HTMLElement).style.borderColor = active ? "#5fbef3" : "#24406b";
        (el as HTMLElement).style.boxShadow = active ? "0 4px 14px rgba(76,167,255,.35)" : "0 2px 10px rgba(0,0,0,.35)";
      });
      
      const svg = svgRef.current!;
      [...svg.querySelectorAll("path")].forEach((p: any) => {
        const id = p.getAttribute("data-id");
        const active = selection && selection.type === "edge" && selection.id === id;
        p.setAttribute("stroke", active ? "#5fbef3" : "#3baed3");
        p.setAttribute("stroke-width", active ? "3" : "2");
      });
    }
  }, [nodeColor, worldRef, svgRef]);

  const drawMinimap = useCallback((nodes: FlowNode[]) => {
    const canvas = minimapRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width = 180;
    const h = canvas.height = 120;
    
    ctx.fillStyle = "#0a1020";
    ctx.fillRect(0, 0, w, h);
    
    if (nodes.length === 0) return;
    
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const xe = nodes.map(n => n.x + n.w);
    const ye = nodes.map(n => n.y + n.h);
    const minx = Math.min(...xs);
    const miny = Math.min(...ys);
    const maxx = Math.max(...xe);
    const maxy = Math.max(...ye);
    const bw = maxx - minx;
    const bh = maxy - miny;
    const scale = Math.min((w - 10) / Math.max(1, bw), (h - 10) / Math.max(1, bh));
    
    ctx.save();
    ctx.translate(5, 5);
    ctx.scale(scale, scale);
    ctx.translate(-minx, -miny);
    ctx.strokeStyle = "#36527e";
    ctx.fillStyle = "#14254a";
    
    nodes.forEach(n => {
      ctx.fillRect(n.x, n.y, n.w, n.h);
      ctx.strokeRect(n.x, n.y, n.w, n.h);
    });
    
    ctx.restore();
  }, [minimapRef]);

  return { draw, drawMinimap };
}