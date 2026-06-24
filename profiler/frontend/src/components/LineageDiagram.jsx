import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Database, Eye, EyeOff, FileInput, GitBranch, LocateFixed, Table2, X } from "lucide-react";

const NODE_WIDTH = 400;
const LAYER_GAP = 550;
const ROW_GAP = 112;
const HEADER_Y = -92;

function nodeId(type, value) {
  return `${type}:${value}`;
}

function getNodeColor(type, subtype) {
  if (type === "query") return "#3b65c7";
  if (type === "output") return "#c17a22";
  if (subtype && subtype !== "workbook-table") return "#8060b8";
  return "#2f946f";
}

function getNodeSoftColor(type, subtype) {
  if (type === "query") return "#eef4ff";
  if (type === "output") return "#fff6e8";
  if (subtype && subtype !== "workbook-table") return "#f4f0ff";
  return "#edf8f3";
}

function getMiniMapColor(type, subtype) {
  if (type === "query") return "#d6e3ff";
  if (type === "output") return "#ffe0b8";
  if (subtype && subtype !== "workbook-table") return "#e4d9ff";
  return "#d1efe1";
}

function truncate(value, max = 52) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function hasWorkbookMirrorSource(query) {
  return (query.sources ?? []).some(
    (source) => source.type === "workbook-table" && source.value === query.name
  );
}

function GraphNode({ data }) {
  const color = getNodeColor(data.type, data.subtype);
  const softColor = getNodeSoftColor(data.type, data.subtype);
  const Icon = data.type === "source" ? FileInput : data.type === "output" ? Table2 : GitBranch;
  const muted = data.muted;

  return (
    <div className={`relative min-h-[86px] rounded-xl border bg-white shadow-sm transition hover:shadow-md ${muted ? "opacity-30" : "opacity-100"}`}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-white" style={{ background: color }} />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-white" style={{ background: color }} />

      <div className="flex gap-3 px-3.5 py-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: softColor, color }}
        >
          <Icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">
              {data.badge}
            </p>
            {data.depthLabel && (
              <span className="rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">
                {data.depthLabel}
              </span>
            )}
          </div>
          <p className="mt-1.5 truncate text-sm font-medium leading-5 text-slate-800" title={data.label}>
              {truncate(data.label, data.type === "output" ? 64 : 52)}
          </p>
          {data.caption && (
            <p className="mt-1 truncate text-xs font-normal leading-4 text-slate-500" title={data.caption}>
              {truncate(data.caption, data.type === "output" ? 56 : 48)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function LaneLabel({ data }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{data.caption}</p>
      <p className="mt-1 text-sm font-medium leading-5 text-slate-700">{data.label}</p>
    </div>
  );
}

const nodeTypes = {
  lineageNode: GraphNode,
  laneLabel: LaneLabel,
};

function buildVisibleQueries(queries, showLoadedChainsOnly) {
  if (!showLoadedChainsOnly) return queries;

  const byName = new Map(queries.map((query) => [query.name, query]));
  const keep = new Set();

  function addAncestors(name) {
    if (keep.has(name)) return;
    keep.add(name);

    const query = byName.get(name);
    (query?.dependencies ?? []).forEach(addAncestors);
  }

  queries
    .filter((query) => (query.outputs ?? []).length > 0)
    .forEach((query) => addAncestors(query.name));

  return queries.filter((query) => keep.has(query.name));
}

function buildDepths(queries) {
  const byName = new Map(queries.map((query) => [query.name, query]));
  const visiting = new Set();
  const memo = new Map();

  function depthOf(name) {
    if (memo.has(name)) return memo.get(name);
    if (visiting.has(name)) return 1;

    visiting.add(name);
    const query = byName.get(name);
    const visibleDependencies = (query?.dependencies ?? []).filter((dependency) => byName.has(dependency));
    const depth = visibleDependencies.length
      ? Math.max(...visibleDependencies.map((dependency) => depthOf(dependency) + 1))
      : 1;

    visiting.delete(name);
    memo.set(name, depth);
    return depth;
  }

  queries.forEach((query) => depthOf(query.name));
  return memo;
}

function buildGraph(queries, options) {
  const visibleQueries = buildVisibleQueries(queries, options.showLoadedChainsOnly);
  const queryNames = new Set(visibleQueries.map((query) => query.name));
  const depths = buildDepths(visibleQueries);
  const maxDepth = Math.max(1, ...[...depths.values()]);
  const nodes = [];
  const edges = [];
  const layerRows = new Map();
  const adjacency = { upstream: new Map(), downstream: new Map() };

  const addAdjacency = (from, to) => {
    if (!adjacency.downstream.has(from)) adjacency.downstream.set(from, new Set());
    if (!adjacency.upstream.has(to)) adjacency.upstream.set(to, new Set());
    adjacency.downstream.get(from).add(to);
    adjacency.upstream.get(to).add(from);
  };

  const nextPosition = (layer) => {
    const row = layerRows.get(layer) ?? 0;
    layerRows.set(layer, row + 1);
    return { x: layer * LAYER_GAP, y: row * ROW_GAP };
  };

  const addNode = (id, layer, data) => {
    const position = nextPosition(layer);
    nodes.push({
      id,
      type: "lineageNode",
      position,
      data,
      style: {
        width: NODE_WIDTH,
        borderColor: "#dbe3ef",
      },
    });
  };

  const addEdge = (source, target, kind) => {
    const isQuery = kind === "query-reference";
    const color = isQuery ? "#6384d8" : kind === "loads-to" ? "#d39a55" : "#8a98aa";

    edges.push({
      id: `${source}->${target}:${kind}`,
      source,
      target,
      type: "smoothstep",
      animated: isQuery,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
      },
      data: { kind },
      style: {
        stroke: color,
        strokeWidth: isQuery ? 2.1 : 1.7,
        strokeDasharray: isQuery ? undefined : "8 8",
        opacity: 0.78,
      },
    });
    addAdjacency(source, target);
  };

  nodes.push(
    {
      id: "lane:sources",
      type: "laneLabel",
      position: { x: 0, y: HEADER_Y },
      selectable: false,
      draggable: false,
      data: { caption: "Inputs", label: "Workbook tables and external sources" },
      style: { width: NODE_WIDTH },
    },
    ...Array.from({ length: maxDepth }, (_, index) => ({
      id: `lane:query:${index + 1}`,
      type: "laneLabel",
      position: { x: (index + 1) * LAYER_GAP, y: HEADER_Y },
      selectable: false,
      draggable: false,
      data: {
        caption: index === 0 ? "Base queries" : "Dependent queries",
        label: index === 0 ? "Read and standardize inputs" : `Dependency layer ${index + 1}`,
      },
      style: { width: NODE_WIDTH },
    })),
    {
      id: "lane:outputs",
      type: "laneLabel",
      position: { x: (maxDepth + 2) * LAYER_GAP, y: HEADER_Y },
      selectable: false,
      draggable: false,
      data: { caption: "Outputs", label: "Loaded worksheet tables" },
      style: { width: NODE_WIDTH },
    }
  );

  visibleQueries
    .slice()
    .sort((a, b) => (depths.get(a.name) ?? 1) - (depths.get(b.name) ?? 1) || a.name.localeCompare(b.name))
    .forEach((query) => {
      const depth = depths.get(query.name) ?? 1;
      addNode(nodeId("query", query.name), depth, {
        type: "query",
        badge: query.outputs?.length ? "Loaded query" : "Connection only",
        label: query.name,
        caption: hasWorkbookMirrorSource(query) ? "Reads matching workbook table" : `${query.dependencies?.length ?? 0} upstream queries`,
        depthLabel: `L${depth}`,
        query,
      });
    });

  visibleQueries.forEach((query) => {
    const queryNode = nodeId("query", query.name);
    const queryDepth = depths.get(query.name) ?? 1;

    (query.sources ?? []).forEach((source) => {
      if (
        !options.showSourceTables &&
        source.type === "workbook-table" &&
        source.value === query.name
      ) {
        return;
      }

      const id = nodeId("source", `${source.type}:${source.value}`);

      if (!nodes.some((node) => node.id === id)) {
        addNode(id, Math.max(0, queryDepth - 1), {
          type: "source",
          badge: source.type,
          label: source.value,
          caption: source.type === "workbook-table" ? "Workbook table" : "External source",
          subtype: source.type,
          source,
        });
      }
      addEdge(id, queryNode, source.type);
    });

    (query.dependencies ?? []).forEach((dependency) => {
      if (queryNames.has(dependency)) {
        addEdge(nodeId("query", dependency), queryNode, "query-reference");
      }
    });

    (query.outputs ?? []).forEach((output) => {
      const label = `${output.sheetName}!${output.tableName}`;
      const id = nodeId("output", label);

      if (!nodes.some((node) => node.id === id)) {
        addNode(id, maxDepth + 2, {
          type: "output",
          badge: "Worksheet output",
          label,
          caption: output.range,
          output,
        });
      }
      addEdge(queryNode, id, "loads-to");
    });
  });

  return { nodes, edges, adjacency, visibleQueries, maxDepth };
}

function collectConnected(startId, adjacency) {
  if (!startId) return { upstream: new Set(), downstream: new Set(), all: new Set() };

  const walk = (map) => {
    const seen = new Set();
    const stack = [...(map.get(startId) ?? [])];

    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;

      seen.add(id);
      (map.get(id) ?? []).forEach((next) => stack.push(next));
    }

    return seen;
  };

  const upstream = walk(adjacency.upstream);
  const downstream = walk(adjacency.downstream);
  return {
    upstream,
    downstream,
    all: new Set([startId, ...upstream, ...downstream]),
  };
}

function Toolbar({
  showLoadedChainsOnly,
  setShowLoadedChainsOnly,
  showSourceTables,
  setShowSourceTables,
  inspectorOpen,
  setInspectorOpen,
  selectedNodeId,
  clearSelection,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      <ToggleButton active={showLoadedChainsOnly} onClick={() => setShowLoadedChainsOnly((value) => !value)}>
        <LocateFixed size={14} />
        Loaded chains
      </ToggleButton>
      <ToggleButton active={showSourceTables} onClick={() => setShowSourceTables((value) => !value)}>
        {showSourceTables ? <Eye size={14} /> : <EyeOff size={14} />}
        Source tables
      </ToggleButton>
      <ToggleButton active={inspectorOpen} onClick={() => setInspectorOpen((value) => !value)}>
        {inspectorOpen ? <Eye size={14} /> : <EyeOff size={14} />}
        Inspector
      </ToggleButton>
      <div className="flex flex-wrap items-center gap-3 px-2 text-xs font-normal text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-5 rounded-full bg-blue-400" />
          dependency
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-5 rounded-full bg-amber-400" />
          output
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-5 rounded-full bg-slate-400" />
          source
        </span>
      </div>
      {selectedNodeId && (
        <button
          type="button"
          onClick={clearSelection}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <X size={14} />
          Clear focus
        </button>
      )}
    </div>
  );
}

function ToggleButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function Inspector({ selected, connected }) {
  if (!selected) {
    return (
      <aside className="w-full shrink-0 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 lg:w-80">
        Click a query, source, or output to focus its upstream and downstream path.
      </aside>
    );
  }

  const data = selected.data;
  const query = data.query;

  return (
    <aside className="w-full shrink-0 rounded-xl border border-slate-200 bg-white p-4 lg:w-80">
      <div className="mb-4 flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{
            backgroundColor: getNodeSoftColor(data.type, data.subtype),
            color: getNodeColor(data.type, data.subtype),
          }}
        >
          <Database size={17} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{data.badge || data.type}</p>
          <h3 className="mt-1 break-words text-sm font-medium leading-5 text-slate-800">{data.label}</h3>
          {data.caption && <p className="mt-1 text-xs text-slate-500">{data.caption}</p>}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Metric label="Upstream" value={connected.upstream.size} />
        <Metric label="Downstream" value={connected.downstream.size} />
      </div>

      {query && (
        <div className="space-y-4">
          <Metric label="Direct dependencies" value={query.dependencies?.length ?? 0} />
          <Metric label="Outputs" value={query.outputs?.length ?? 0} />

          {query.dependencies?.length > 0 && (
            <DetailList title="Depends on" items={query.dependencies} />
          )}
          {query.outputs?.length > 0 && (
            <DetailList
              title="Loads to"
              items={query.outputs.map((output) => `${output.sheetName}!${output.tableName}`)}
            />
          )}
          {query.transformations?.length > 0 && (
            <DetailList
              title="Transforms"
              items={query.transformations.map((item) => `${item.label} (${item.count})`)}
            />
          )}
        </div>
      )}
    </aside>
  );
}

function Metric({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function DetailList({ title, items }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      <div className="space-y-1">
        {items.map((item) => (
          <p key={item} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function LineageDiagram({ queries }) {
  const [showLoadedChainsOnly, setShowLoadedChainsOnly] = useState(true);
  const [showSourceTables, setShowSourceTables] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const graph = useMemo(
    () => buildGraph(queries, { showLoadedChainsOnly, showSourceTables }),
    [queries, showLoadedChainsOnly, showSourceTables]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const connected = useMemo(
    () => collectConnected(selectedNodeId, graph.adjacency),
    [graph.adjacency, selectedNodeId]
  );

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelectedNodeId(null);
  }, [graph, setEdges, setNodes]);

  const styledNodes = useMemo(
    () =>
      nodes.map((node) => {
        const isLane = node.type === "laneLabel";
        const focused = !selectedNodeId || connected.all.has(node.id) || isLane;
        const selected = node.id === selectedNodeId;

        return {
          ...node,
          data: {
            ...node.data,
            muted: !focused,
          },
          style: {
            ...node.style,
            borderColor: selected ? getNodeColor(node.data.type, node.data.subtype) : node.style?.borderColor,
            boxShadow: selected
              ? `0 0 0 3px ${getNodeColor(node.data.type, node.data.subtype)}26`
              : node.style?.boxShadow,
          },
        };
      }),
    [connected.all, nodes, selectedNodeId]
  );
  const styledEdges = useMemo(
    () =>
      edges.map((edge) => {
        const focused = !selectedNodeId || (connected.all.has(edge.source) && connected.all.has(edge.target));

        return {
          ...edge,
          animated: focused && edge.data?.kind === "query-reference",
          style: {
            ...edge.style,
            opacity: focused ? edge.style.opacity ?? 0.78 : 0.1,
            strokeWidth: focused ? edge.style.strokeWidth : 1.2,
          },
        };
      }),
    [connected.all, edges, selectedNodeId]
  );
  const selectedNode = styledNodes.find((node) => node.id === selectedNodeId);

  return (
    <div className="space-y-3">
      <Toolbar
        showLoadedChainsOnly={showLoadedChainsOnly}
        setShowLoadedChainsOnly={setShowLoadedChainsOnly}
        showSourceTables={showSourceTables}
        setShowSourceTables={setShowSourceTables}
        inspectorOpen={inspectorOpen}
        setInspectorOpen={setInspectorOpen}
        selectedNodeId={selectedNodeId}
        clearSelection={() => setSelectedNodeId(null)}
      />

      <div className={`grid gap-4 ${inspectorOpen ? "lg:grid-cols-[minmax(0,1fr)_320px]" : "lg:grid-cols-1"}`}>
        <section
          className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
          style={{ height: "min(82vh, 920px)", minHeight: 680 }}
        >
          <ReactFlowProvider>
            <ReactFlow
              nodes={styledNodes}
              edges={styledEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => {
                if (node.type !== "laneLabel") {
                  setSelectedNodeId(node.id);
                  setInspectorOpen(true);
                }
              }}
              onPaneClick={() => setSelectedNodeId(null)}
              defaultViewport={{ x: 36, y: 120, zoom: 0.82 }}
              minZoom={0.12}
              maxZoom={1.5}
            >
              <Background color="#cbd5e1" gap={18} />
              <Controls showInteractive={false} />
              <MiniMap
                position="bottom-right"
                nodeColor={(node) => getMiniMapColor(node.data.type, node.data.subtype)}
                nodeStrokeColor={(node) => getNodeColor(node.data.type, node.data.subtype)}
                nodeBorderRadius={4}
                maskColor="rgba(248, 250, 252, 0.72)"
                pannable
                zoomable
                style={{
                  width: 150,
                  height: 96,
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  background: "rgba(255, 255, 255, 0.92)",
                  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
                  overflow: "hidden",
                }}
              />
            </ReactFlow>
          </ReactFlowProvider>
        </section>

        {inspectorOpen && <Inspector selected={selectedNode} connected={connected} />}
      </div>
    </div>
  );
}
