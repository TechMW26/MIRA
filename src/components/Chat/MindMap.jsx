import { useMemo, useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';

const NODE_W = 160;
const NODE_H = 40;
const H_GAP = 80;
const V_GAP = 20;

function parseMindMap(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  const items = lines.map((l) => ({
    depth: l.match(/^(\s*)/)[1].length / 2,
    label: l.trim().replace(/^[-*•]+\s*/, ''),
  })).filter((i) => i.label);

  if (!items.length) return { nodes: [], edges: [] };

  // Build tree structure
  const tree = [];
  const stack = []; // stack of { item, children }
  for (const item of items) {
    const node = { ...item, children: [], id: String(tree.length + 1) };
    tree.push(node);
    while (stack.length && stack[stack.length - 1].depth >= item.depth) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const roots = tree.filter((n) => n.depth === 0);

  // Measure subtree height (in units)
  function subtreeHeight(node) {
    if (!node.children.length) return 1;
    return node.children.reduce((s, c) => s + subtreeHeight(c), 0);
  }

  // Assign positions — left-to-right tree layout
  const positions = {};
  function layout(node, x, yStart) {
    const h = subtreeHeight(node);
    const y = yStart + (h / 2) * (NODE_H + V_GAP) - NODE_H / 2;
    positions[node.id] = { x, y };
    let childY = yStart;
    for (const child of node.children) {
      const ch = subtreeHeight(child);
      layout(child, x + NODE_W + H_GAP, childY);
      childY += ch * (NODE_H + V_GAP);
    }
  }

  let yOffset = 0;
  for (const root of roots) {
    layout(root, 0, yOffset);
    yOffset += subtreeHeight(root) * (NODE_H + V_GAP) + 40;
  }

  // Color palette per depth
  const DEPTH_COLORS = [
    { bg: '#7c3aed', text: '#ffffff', border: '#7c3aed' },
    { bg: '#2563eb', text: '#ffffff', border: '#2563eb' },
    { bg: '#0891b2', text: '#ffffff', border: '#0891b2' },
    { bg: '#059669', text: '#ffffff', border: '#059669' },
    { bg: '#d97706', text: '#ffffff', border: '#d97706' },
  ];

  const EDGE_COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706'];

  const nodes = tree.map((n) => {
    const c = DEPTH_COLORS[Math.min(n.depth, DEPTH_COLORS.length - 1)];
    const isRoot = n.depth === 0;
    return {
      id: n.id,
      data: { label: n.label },
      position: positions[n.id] || { x: 0, y: 0 },
      style: {
        background: isRoot ? c.bg : '#ffffff',
        color: isRoot ? c.text : '#1e293b',
        border: `2px solid ${c.bg}`,
        borderRadius: isRoot ? 14 : 10,
        fontWeight: isRoot ? 700 : 500,
        fontSize: isRoot ? 13 : 12,
        padding: '6px 14px',
        width: NODE_W,
        minHeight: NODE_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        boxShadow: isRoot ? '0 4px 14px rgba(124,58,237,0.3)' : '0 1px 4px rgba(0,0,0,0.08)',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
      },
    };
  });

  const edges = [];
  for (const node of tree) {
    for (const child of node.children) {
      const color = EDGE_COLORS[Math.min(node.depth, EDGE_COLORS.length - 1)];
      edges.push({
        id: `e${node.id}-${child.id}`,
        source: node.id,
        target: child.id,
        type: 'smoothstep',
        style: { stroke: color, strokeWidth: 2, opacity: 0.7 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
      });
    }
  }

  return { nodes, edges };
}

export default function MindMap({ content }) {
  const { nodes: initNodes, edges: initEdges } = useMemo(() => parseMindMap(content), [content]);
  const [nodes, , onNodesChange] = useNodesState(initNodes);
  const [edges, , onEdgesChange] = useEdgesState(initEdges);

  return (
    <div
      className="rounded-2xl overflow-hidden my-3"
      style={{ height: 460, border: '1px solid #e2e8f0', background: '#f8fafc' }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        attributionPosition="bottom-right"
      >
        <Background color="#e2e8f0" gap={20} size={1} />
        <Controls
          showInteractive={false}
          style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8 }}
        />
        <MiniMap
<<<<<<< Updated upstream
          nodeColor={(n) => n.style?.border?.split(' ')[2] || '#7c3aed'}
=======
<<<<<<< HEAD
          nodeColor={(n) => {
            const borderColor = n.style?.border?.match(/#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})/);
            return borderColor ? borderColor[0] : '#7c3aed';
          }}
=======
          nodeColor={(n) => n.style?.border?.split(' ')[2] || '#7c3aed'}
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
          style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8 }}
          maskColor="rgba(248,250,252,0.7)"
        />
      </ReactFlow>
    </div>
  );
}
