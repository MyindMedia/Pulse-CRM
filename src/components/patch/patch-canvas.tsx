"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Check,
  CloudOff,
  GitBranch,
  Loader2,
  Cable as CableIcon,
  Keyboard,
  LayoutGrid,
  Maximize2,
  Minus,
  Plus,
  Redo2,
  Route,
  Spline,
  Undo2,
  Waves,
  Zap,
  ZapOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Tooltip, prettyKeys } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeviceNode, type DeviceNodeData, type PatchPort } from "./device-node";
import { PatchEdge, type PatchEdgeData, type PatchRenderMode } from "./patch-edge";
import { announceCableJolt } from "./cable-jolt";
import { PanelRail } from "./panel-rail";
import { NoteNode, NOTE_COLORS, NOTE_DEFAULT_SIZE, type NoteNodeData } from "./note-node";
import { CanvasContextMenu, type MenuState, type MenuItem } from "./canvas-context-menu";
import { useCollapsiblePanel } from "@/lib/use-collapsible-panel";
import { CablePickerDialog } from "./cable-picker-dialog";
import { autoArrange } from "./auto-arrange";
import { DevicePalette, type PaletteItem, type PaletteProfile } from "./device-palette";
import { PropertiesPanel, type PatchSelection } from "./properties-panel";
import { CustomDeviceDialog } from "./custom-device-dialog";
import { ANIMATION_CONNECTION_LIMIT, GRID } from "./constants";

const nodeTypes = { device: DeviceNode, note: NoteNode };
const edgeTypes = { patch: PatchEdge };

type GraphDevice = {
  _id: Id<"deviceInstances">;
  label: string;
  notes?: string;
  normalling?: string;
  position: { x: number; y: number };
  category: string;
  manufacturer: string;
  phantomSensitive: boolean;
  rackUnits?: number;
  photoUrl: string | null;
  photoIsOwn: boolean;
  panelPhotoUrl: string | null;
  profileId: Id<"deviceProfiles">;
  specSource: "curated" | "ai" | "category" | "manual";
  specVerified: boolean;
  specNote: string | null;
  equipment: {
    _id: Id<"equipment">;
    name: string;
    serialNumber: string | null;
    condition: string | null;
    quantity: number;
  } | null;
  ports: PatchPort[];
};

type GraphConnection = {
  _id: Id<"connections">;
  fromPortId: string;
  toPortId: string;
  isNormalled: boolean;
  cableId?: Id<"equipment">;
  cableTag?: string;
  cableTagSource?: string;
  cableTagTarget?: string;
  cableLabelMode?: "single" | "perEnd";
  cableColor?: string;
  color: string | null;
  lengthFt: number | null;
  notes?: string;
};

type GraphNote = {
  _id: Id<"patchAnnotations">;
  text: string;
  color: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
};

type GraphPayload = {
  space: { _id: Id<"patchSpaces">; name: string };
  devices: GraphDevice[];
  connections: GraphConnection[];
  annotations: GraphNote[];
};

/**
 * Zoom controls. React Flow ships its own, but they carry only bare `title`
 * attributes and no zoom readout, so they are replaced rather than restyled.
 * The percentage is the piece people actually look for when a diagram feels
 * like the wrong size.
 */
function ZoomCluster() {
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const pct = Math.round(zoom * 100);

  return (
    <div className="flex items-center gap-0.5 rounded-chrome border border-hairline-2 bg-coal/90 p-1 shadow-elev-3 backdrop-blur-sm">
      <Tooltip label="Zoom out" shortcut="cmd+minus" side="top">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => zoomOut({ duration: 150 })}
        >
          <Minus className="size-4" />
        </Button>
      </Tooltip>

      <Tooltip label="Reset to 100 percent" hint={`Currently ${pct} percent.`} side="top">
        <button
          type="button"
          onClick={() => zoomTo(1, { duration: 200 })}
          aria-label={`Zoom level ${pct} percent. Click to reset to 100 percent.`}
          className="min-w-11 rounded-md px-1 py-1 text-center font-meta text-[10px] font-semibold tabular-nums text-ash transition-colors hover:bg-coal-3 hover:text-bone"
        >
          {pct}%
        </button>
      </Tooltip>

      <Tooltip label="Zoom in" shortcut="cmd+plus" side="top">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => zoomIn({ duration: 150 })}
        >
          <Plus className="size-4" />
        </Button>
      </Tooltip>

      <span className="mx-0.5 h-5 w-px bg-hairline-2" />

      <Tooltip label="Fit the whole patch on screen" shortcut="f" side="top">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Fit view"
          onClick={() => fitView({ padding: 0.15, duration: 300 })}
        >
          <Maximize2 className="size-4" />
        </Button>
      </Tooltip>
    </div>
  );
}

/**
 * Where the canvas stands with your last change.
 *
 * Every edit here writes straight through, so a Save button that gates the
 * work would be a lie. What is genuinely useful is the opposite: proof it
 * landed, the moment it landed, and one control that force-writes anything
 * still in flight before you close the laptop. That is what this is.
 */
function SaveState({
  state,
  savedAt,
  canEdit,
  onFlush,
}: {
  state: "saved" | "saving" | "failed";
  savedAt: number | null;
  canEdit: boolean;
  onFlush: () => void;
}) {
  // Re-render on a slow tick so "just now" does not sit there for an hour.
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const timer = window.setInterval(force, 20_000);
    return () => window.clearInterval(timer);
  }, []);

  const ago = React.useMemo(() => {
    if (!savedAt) return null;
    const seconds = Math.round((Date.now() - savedAt) / 1000);
    if (seconds < 20) return "just now";
    if (seconds < 90) return "a minute ago";
    if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
    return `${Math.round(seconds / 3600)} h ago`;
  }, [savedAt]);

  const label =
    state === "saving" ? "Saving" : state === "failed" ? "Not saved" : ago ? `Saved ${ago}` : "Saved";

  return (
    <Tooltip
      label={state === "failed" ? "The last change did not save" : "Every change saves as you make it"}
      hint={
        state === "failed"
          ? "Press to write the current layout again."
          : "Nothing is held in a draft. Press to force-write anything still in flight."
      }
      side="top"
    >
      <button
        type="button"
        onClick={onFlush}
        disabled={!canEdit}
        aria-label={`${label}. Save now.`}
        className={cn(
          "flex items-center gap-1.5 rounded-chrome border bg-coal/90 px-2.5 py-2 font-meta text-[10px] uppercase tracking-wide shadow-elev-3 backdrop-blur-sm transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-50",
          state === "failed"
            ? "border-critical/50 text-critical hover:bg-critical/10"
            : "border-hairline-2 text-steel hover:border-gold-dim/60 hover:text-bone",
        )}
      >
        {state === "saving" ? (
          <Loader2 className="size-3 animate-spin" />
        ) : state === "failed" ? (
          <CloudOff className="size-3" />
        ) : (
          <Check className="size-3 text-positive" />
        )}
        {label}
      </button>
    </Tooltip>
  );
}

/** The shortcuts this canvas answers to, in one place. */
const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "cmd+z", what: "Undo" },
  { keys: "cmd+shift+z", what: "Redo" },
  { keys: "cmd+a", what: "Select every device" },
  { keys: "backspace", what: "Remove the selection" },
  { keys: "esc", what: "Clear the selection" },
  { keys: "f", what: "Fit the patch on screen" },
  { keys: "cmd+plus", what: "Zoom in" },
  { keys: "cmd+minus", what: "Zoom out" },
  { keys: "shift+drag", what: "Add to the selection" },
  { keys: "space+drag", what: "Pan the canvas" },
  { keys: "up", what: "Nudge the selection by the grid" },
  { keys: "[", what: "Show or hide the inventory" },
  { keys: "]", what: "Show or hide the properties" },
  { keys: "cmd+\\", what: "Show or hide the app navigation" },
];

/** What a collapsed side panel leaves behind. Enough for an arrow and a name. */
const RAIL_WIDTH = "2.25rem";

/** One reversible action. The stack is what makes the canvas feel safe. */
type HistoryEntry = { label: string; undo: () => Promise<void>; redo: () => Promise<void> };

function PatchCanvasInner({
  patchSpaceId,
  canEdit,
}: {
  patchSpaceId: Id<"patchSpaces">;
  canEdit: boolean;
}) {
  const graph = useQuery(api.patchManager.graph, { patchSpaceId }) as GraphPayload | null | undefined;

  /** Which nodes on the board are sticky notes rather than gear. */
  const noteIds = React.useMemo(
    () => new Set((graph?.annotations ?? []).map((n) => n._id as string)),
    [graph],
  );

  const placeDevice = useMutation(api.patchManager.placeDevice);
  const moveDevice = useMutation(api.patchManager.moveDevice);
  const removeDevice = useMutation(api.patchManager.removeDevice);
  const restoreDevice = useMutation(api.patchManager.restoreDevice);
  const connectPorts = useMutation(api.patchManager.connect);
  const disconnect = useMutation(api.patchManager.disconnect);
  const addNote = useMutation(api.patchManager.addNote);
  const updateNote = useMutation(api.patchManager.updateNote);
  const removeNote = useMutation(api.patchManager.removeNote);

  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  // Both side panels fold away and stay folded, because someone who wants the
  // width for a patch map wants it on every patch map, not just this one.
  const { collapsed: paletteCollapsed, setCollapsed: setPaletteCollapsed, toggle: togglePalette } =
    useCollapsiblePanel("pulse:patch-palette-collapsed");
  const {
    collapsed: propertiesCollapsed,
    setCollapsed: setPropertiesCollapsed,
    toggle: toggleProperties,
  } = useCollapsiblePanel("pulse:patch-properties-collapsed");

  /*
   * What the canvas has done with your last change. Everything here writes
   * through immediately - there is no draft to lose - so the honest control
   * is a status you can read plus a way to force a flush, not a Save button
   * that pretends the work was waiting on you.
   */
  const [saveState, setSaveState] = React.useState<"saved" | "saving" | "failed">("saved");
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  const [menu, setMenu] = React.useState<MenuState>(null);
  const closeMenu = React.useCallback(() => setMenu(null), []);

  const [mode, setMode] = React.useState<PatchRenderMode>("cable");
  const [animate, setAnimate] = React.useState(true);
  const [trace, setTrace] = React.useState(false);
  const [customOpen, setCustomOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  // The run we just drew, waiting to be told which cable it is.
  const [askCableFor, setAskCableFor] = React.useState<Id<"connections"> | null>(null);
  const [arranging, setArranging] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<{ nodes: string[]; edges: string[] }>({
    nodes: [],
    edges: [],
  });

  // History is state, not a ref, so the toolbar buttons enable and disable
  // as the stacks change instead of going stale.
  const [undoStack, setUndoStack] = React.useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = React.useState<HistoryEntry[]>([]);

  const pushHistory = React.useCallback((entry: HistoryEntry) => {
    setUndoStack((stack) => [...stack, entry].slice(-50));
    // A new action invalidates the redo branch, same as every editor.
    setRedoStack([]);
  }, []);

  /* ── Derived state ─────────────────────────────────────────── */

  const portIndex = React.useMemo(() => {
    const map = new Map<string, { port: PatchPort; device: GraphDevice }>();
    for (const device of graph?.devices ?? []) {
      for (const port of device.ports) map.set(port._id, { port, device });
    }
    return map;
  }, [graph]);

  const connectedPorts = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of graph?.connections ?? []) {
      set.add(c.fromPortId);
      set.add(c.toPortId);
    }
    return set;
  }, [graph]);

  // The travelling arrows are SMIL, which CSS cannot switch off, so the
  // preference has to be read here and kill the animation at the source.
  const reducedMotion = React.useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined") return () => {};
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

  const connectionCount = graph?.connections.length ?? 0;
  // Above the threshold the animation costs more than it explains.
  const animationOn =
    animate && !reducedMotion && connectionCount <= ANIMATION_CONNECTION_LIMIT;

  /**
   * The signal path through the selection: everything the selection feeds,
   * and everything that feeds it. Followed in each direction separately, so
   * a sibling that merely shares a destination is not swept in. Flooding an
   * undirected graph would just light the whole connected component, which
   * on any real rig is every device in the room.
   */
  const tracedDevices = React.useMemo(() => {
    if (!trace || !graph || selectedIds.nodes.length === 0) return null;

    const downstream = new Map<string, Set<string>>();
    const upstream = new Map<string, Set<string>>();
    for (const c of graph.connections) {
      const from = portIndex.get(c.fromPortId)?.device._id;
      const to = portIndex.get(c.toPortId)?.device._id;
      if (!from || !to) continue;
      if (!downstream.has(from)) downstream.set(from, new Set());
      if (!upstream.has(to)) upstream.set(to, new Set());
      downstream.get(from)!.add(to);
      upstream.get(to)!.add(from);
    }

    const seen = new Set<string>(selectedIds.nodes);
    for (const edges of [downstream, upstream]) {
      const queue = [...selectedIds.nodes];
      while (queue.length) {
        const current = queue.shift()!;
        for (const next of edges.get(current) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
    }
    return seen;
  }, [trace, graph, selectedIds.nodes, portIndex]);

  /**
   * For every input port, the phantom-sensitive device currently patched
   * into it. A ribbon is destroyed by 48V arriving down the cable, so the
   * warning belongs on the preamp input that would send it, not on the mic.
   */
  const phantomRiskByPort = React.useMemo(() => {
    const risk = new Map<string, Record<string, string>>();
    if (!graph) return risk;
    for (const c of graph.connections) {
      const source = portIndex.get(c.fromPortId);
      const target = portIndex.get(c.toPortId);
      if (!source || !target) continue;
      if (!source.device.phantomSensitive) continue;
      const forDevice = risk.get(target.device._id) ?? {};
      forDevice[c.toPortId] = source.device.label;
      risk.set(target.device._id, forDevice);
    }
    return risk;
  }, [graph, portIndex]);

  /* ── Sync server graph into React Flow ─────────────────────── */

  // Positions being dragged right now must not be stomped by a server
  // echo of the pre-drag position, so live drags are held back.
  const draggingRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!graph) return;
    setNodes((previous) => {
      const prevById = new Map(previous.map((n) => [n.id, n]));
      const deviceNodes = graph.devices.map((device) => {
        const existing = prevById.get(device._id);
        const dragging = draggingRef.current.has(device._id);
        return {
          id: device._id,
          type: "device",
          position: dragging && existing ? existing.position : device.position,
          selected: existing?.selected ?? false,
          data: {
            label: device.label,
            category: device.category,
            manufacturer: device.manufacturer,
            phantomSensitive: device.phantomSensitive,
            rackUnits: device.rackUnits,
            ports: device.ports,
            connectedPorts,
            equipment: device.equipment,
            photoUrl: device.photoUrl,
            photoIsOwn: device.photoIsOwn,
            specUnverified:
              !device.specVerified &&
              (device.specSource === "ai" || device.specSource === "category"),
            traceDimmed: !!tracedDevices && !tracedDevices.has(device._id),
          } satisfies DeviceNodeData,
        } as Node;
      });

      // Notes ride alongside the devices in the same node list. They sit
      // first so a note can never cover a device it was written about.
      const noteNodes = graph.annotations.map((note) => {
        const existing = prevById.get(note._id);
        const dragging = draggingRef.current.has(note._id);
        return {
          id: note._id,
          type: "note",
          position: dragging && existing ? existing.position : note.position,
          selected: existing?.selected ?? false,
          draggable: canEdit,
          data: {
            text: note.text,
            color: note.color,
            width: note.size?.width ?? NOTE_DEFAULT_SIZE.width,
            height: note.size?.height ?? NOTE_DEFAULT_SIZE.height,
            canEdit,
            onChangeText: (text: string) => void updateNote({ id: note._id, text }),
          } satisfies NoteNodeData,
        } as Node;
      });

      return [...noteNodes, ...deviceNodes];
    });
  }, [graph, connectedPorts, tracedDevices, setNodes, canEdit, updateNote]);

  React.useEffect(() => {
    if (!graph) return;
    setEdges((previous) => {
      // Carry selection across the rebuild, the same way nodes do. Without
      // this, editing anything about a cable deselects it and closes the
      // panel you were editing it in, mid-edit.
      const wasSelected = new Set(previous.filter((e) => e.selected).map((e) => e.id));
      return graph.connections.map((c) => {
        const from = portIndex.get(c.fromPortId);
        const to = portIndex.get(c.toPortId);
        const dimmed =
          !!tracedDevices &&
          !(
            (from && tracedDevices.has(from.device._id)) ||
            (to && tracedDevices.has(to.device._id))
          );
        return {
          id: c._id,
          source: from?.device._id ?? "",
          target: to?.device._id ?? "",
          sourceHandle: c.fromPortId,
          targetHandle: c.toPortId,
          type: "patch",
          selected: wasSelected.has(c._id),
          data: {
            mode,
            signalLevel: from?.port.signalLevel ?? "line",
            cableColor: c.color,
            cableTag: c.cableTag ?? null,
            cableTagSource: c.cableTagSource ?? null,
            cableTagTarget: c.cableTagTarget ?? null,
            isNormalled: c.isNormalled,
            animated: animationOn,
            traceDimmed: dimmed,
            unassigned: !c.cableId && !c.isNormalled,
          } satisfies PatchEdgeData,
        } as Edge;
      });
    });
  }, [graph, mode, animationOn, tracedDevices, portIndex, setEdges]);

  // ReactFlow's own fitView runs on mount, when the graph is still empty
  // because the query has not landed. It also cannot compute bounds until
  // the nodes have been measured, and these cards size themselves from
  // their port count. Waiting for both is what stops a room opening with
  // half its rack off the right-hand edge.
  const nodesInitialized = useNodesInitialized();
  const fitted = React.useRef(false);
  React.useEffect(() => {
    if (fitted.current || !nodesInitialized || nodes.length === 0) return;
    fitted.current = true;
    void fitView({ padding: 0.15, duration: 260, maxZoom: 1.1, minZoom: 0.1 });
  }, [nodesInitialized, nodes.length, fitView]);

  /* ── Selection ─────────────────────────────────────────────── */

  const onSelectionChange = React.useCallback(
    ({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
      setSelectedIds({ nodes: selNodes.map((n) => n.id), edges: selEdges.map((e) => e.id) });
    },
    [],
  );

  /**
   * What the properties panel shows, derived from the live graph rather
   * than snapshotted at selection time. Editing a cable updates the graph,
   * and a snapshot would leave the panel describing the old values while
   * the user is still looking at it.
   */
  const selection = React.useMemo<PatchSelection>(() => {
    if (!graph) return null;

    if (selectedIds.nodes.length === 1 && selectedIds.edges.length === 0) {
      const note = graph.annotations.find((n) => n._id === selectedIds.nodes[0]);
      if (note) {
        return { kind: "note", _id: note._id, text: note.text, color: note.color };
      }
      const device = graph.devices.find((d) => d._id === selectedIds.nodes[0]);
      if (!device) return null;
      return {
        kind: "device",
        _id: device._id,
        label: device.label,
        notes: device.notes,
        normalling: device.normalling,
        category: device.category,
        manufacturer: device.manufacturer,
        phantomSensitive: device.phantomSensitive,
        ports: device.ports,
        photoUrl: device.photoUrl,
        photoIsOwn: device.photoIsOwn,
        panelPhotoUrl: device.panelPhotoUrl,
        profileId: device.profileId,
        specSource: device.specSource,
        specVerified: device.specVerified,
        specNote: device.specNote,
        equipment: device.equipment,
        phantomRiskByPort: phantomRiskByPort.get(device._id) ?? {},
      };
    }

    if (selectedIds.edges.length === 1 && selectedIds.nodes.length === 0) {
      const connection = graph.connections.find((c) => c._id === selectedIds.edges[0]);
      if (!connection) return null;
      const from = portIndex.get(connection.fromPortId);
      const to = portIndex.get(connection.toPortId);
      return {
        kind: "connection",
        _id: connection._id,
        cableId: connection.cableId,
        cableTag: connection.cableTag,
        cableLabelMode: connection.cableLabelMode,
        cableTagSource: connection.cableTagSource,
        cableTagTarget: connection.cableTagTarget,
        cableColor: connection.cableColor ?? connection.color ?? undefined,
        cableLengthFt: connection.lengthFt ?? undefined,
        notes: connection.notes,
        sourceLabel: `${from?.device.label ?? "?"} · ${from?.port.label ?? "?"}`,
        targetLabel: `${to?.device.label ?? "?"} · ${to?.port.label ?? "?"}`,
      };
    }

    return null;
  }, [graph, selectedIds, portIndex, phantomRiskByPort]);

  /* ── Mutations with history ────────────────────────────────── */

  /**
   * A cable can go anywhere except back into the box it came from, or into
   * the jack it started at. Everything else, including the unconventional
   * patches engineers do on purpose, is allowed and flagged later.
   */
  const isValidConnection = React.useCallback(
    (connection: Connection | Edge) => {
      const from = connection.sourceHandle ? portIndex.get(connection.sourceHandle) : null;
      const to = connection.targetHandle ? portIndex.get(connection.targetHandle) : null;
      if (!from || !to) return false;
      if (from.port._id === to.port._id) return false;
      return from.device._id !== to.device._id;
    },
    [portIndex],
  );

  const handleConnect = React.useCallback(
    async (connection: Connection) => {
      if (!canEdit || !connection.sourceHandle || !connection.targetHandle) return;
      const from = portIndex.get(connection.sourceHandle);
      const to = portIndex.get(connection.targetHandle);
      if (!from || !to) return;

      // Guard the one case that is a mistake rather than a choice: patching
      // a jack into itself. Everything else, including output to output, is
      // allowed and warned about later, per the spec.
      if (connection.sourceHandle === connection.targetHandle) return;

      try {
        const args = {
          fromPortId: connection.sourceHandle as Id<"ports">,
          toPortId: connection.targetHandle as Id<"ports">,
        };
        // Patching an input replaces whatever was in it, which is correct at
        // the bay but means undo has to put the displaced run back or it is a
        // net loss: the old cable, its stock row, tag and colour all vanish.
        const displaced = graph?.connections.find(
          (c) => c.toPortId === connection.targetHandle && !c.isNormalled,
        );
        // Redo mints a new row, so the entry tracks the current id rather
        // than closing over the first one. Otherwise undo after a redo
        // targets a row that no longer exists.
        const live = { id: (await connectPorts(args)) as Id<"connections"> };
        // Ask now, while the engineer is still holding the cable. Asking
        // later, from a table, means guessing.
        setAskCableFor(live.id);
        pushHistory({
          label: "patch",
          undo: async () => {
            await disconnect({ id: live.id });
            if (displaced) {
              await connectPorts({
                fromPortId: displaced.fromPortId as Id<"ports">,
                toPortId: displaced.toPortId as Id<"ports">,
                cableId: displaced.cableId,
                cableTag: displaced.cableTag,
                cableColor: displaced.cableColor,
              });
            }
          },
          redo: async () => {
            live.id = (await connectPorts(args)) as Id<"connections">;
          },
        });
      } catch (error) {
        toast.error(errorMessage(error, "Could not patch that."));
      }
    },
    [canEdit, portIndex, connectPorts, disconnect, pushHistory, graph],
  );

  const place = React.useCallback(
    async (payload: { equipmentId?: Id<"equipment">; profileId?: Id<"deviceProfiles"> }, at?: { x: number; y: number }) => {
      if (!canEdit) return;
      // Drop where the pointer is, otherwise stagger new devices so they
      // do not stack into one pile in the corner.
      const position =
        at ??
        (() => {
          const count = graph?.devices.length ?? 0;
          return { x: 80 + (count % 4) * 300, y: 80 + Math.floor(count / 4) * 220 };
        })();
      try {
        const live = {
          id: (await placeDevice({ patchSpaceId, position, ...payload })) as Id<"deviceInstances">,
        };
        pushHistory({
          label: "place",
          undo: async () => {
            await removeDevice({ id: live.id });
          },
          redo: async () => {
            live.id = (await placeDevice({
              patchSpaceId,
              position,
              ...payload,
            })) as Id<"deviceInstances">;
          },
        });
      } catch (error) {
        toast.error(errorMessage(error, "Could not place that."));
      }
    },
    [canEdit, graph, placeDevice, removeDevice, patchSpaceId, pushHistory],
  );

  const deleteSelection = React.useCallback(async () => {
    if (!canEdit) return;
    const { nodes: selectedNodeIds, edges: edgeIds } = selectedIds;
    if (selectedNodeIds.length === 0 && edgeIds.length === 0) return;

    // Notes and devices share the node list but not the table they came from,
    // and deleting a sticky should never raise a "and every cable on it"
    // confirm for something that has no cables.
    const nodeIds = selectedNodeIds.filter((id) => !noteIds.has(id));
    const doomedNotes = selectedNodeIds.filter((id) => noteIds.has(id));

    const deviceCount = nodeIds.length;
    if (
      deviceCount > 0 &&
      !window.confirm(
        `Remove ${deviceCount} device${deviceCount === 1 ? "" : "s"} and every cable on ${deviceCount === 1 ? "it" : "them"}?`,
      )
    ) {
      return;
    }

    try {
      // Capture what is needed to put each piece back before removing it.
      const edgeSnapshots = edgeIds
        .map((id) => graph?.connections.find((c) => c._id === id))
        .filter(Boolean) as GraphConnection[];

      for (const edge of edgeSnapshots) await disconnect({ id: edge._id });

      const deviceSnapshots: Awaited<ReturnType<typeof removeDevice>>[] = [];
      for (const id of nodeIds) {
        deviceSnapshots.push(await removeDevice({ id: id as Id<"deviceInstances"> }));
      }

      const noteSnapshots: { text: string; color: string; position: { x: number; y: number }; size?: { width: number; height: number } }[] = [];
      for (const id of doomedNotes) {
        noteSnapshots.push(await removeNote({ id: id as Id<"patchAnnotations"> }));
      }

      pushHistory({
        label: "delete",
        undo: async () => {
          for (const note of noteSnapshots) {
            await addNote({
              patchSpaceId,
              position: note.position,
              text: note.text,
              color: note.color,
            });
          }
          for (const snapshot of deviceSnapshots) await restoreDevice(snapshot);
          for (const edge of edgeSnapshots) {
            await connectPorts({
              fromPortId: edge.fromPortId as Id<"ports">,
              toPortId: edge.toPortId as Id<"ports">,
              cableId: edge.cableId,
              cableTag: edge.cableTag,
              cableColor: edge.cableColor,
            });
          }
        },
        redo: async () => {
          // Ids changed on restore, so redo re-reads the live graph by label
          // rather than trusting the ids this closure was built with.
          toast("Re-deleting is not supported. Select and delete again.");
        },
      });
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete."));
    }
  }, [
    canEdit,
    selectedIds,
    disconnect,
    removeDevice,
    restoreDevice,
    connectPorts,
    graph,
    pushHistory,
    removeNote,
    addNote,
    patchSpaceId,
    noteIds,
  ]);

  // One in-flight history operation at a time. Key repeat on a held Cmd+Z
  // would otherwise read the same stack head twice.
  const historyBusy = React.useRef(false);

  const undo = React.useCallback(async () => {
    if (historyBusy.current) return;
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    historyBusy.current = true;
    try {
      await entry.undo();
      setRedoStack((stack) => [...stack, entry]);
    } catch {
      toast.error("Could not undo that. It may already have been changed.");
    } finally {
      // Pop either way. A failed entry that stays on the stack blocks every
      // action underneath it for the rest of the session.
      setUndoStack((stack) => stack.slice(0, -1));
      historyBusy.current = false;
    }
  }, [undoStack]);

  const redo = React.useCallback(async () => {
    if (historyBusy.current) return;
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    historyBusy.current = true;
    try {
      await entry.redo();
      setUndoStack((stack) => [...stack, entry]);
    } catch {
      toast.error("Could not redo that.");
    } finally {
      setRedoStack((stack) => stack.slice(0, -1));
      historyBusy.current = false;
    }
  }, [redoStack]);

  /**
   * Lay the room out along the signal path. Positions are written back
   * through the normal move mutation, so the arrangement is saved for
   * everyone and Cmd+Z is not needed to escape a layout you dislike:
   * the previous positions are one undo of your own drag away.
   */
  const arrange = React.useCallback(async () => {
    if (!canEdit || !graph) return;
    setArranging(true);
    try {
      const measured = getNodes();
      const layout = autoArrange(
        measured.map((n) => ({ id: n.id, height: n.measured?.height ?? 140 })),
        graph.connections
          .map((c) => ({
            source: portIndex.get(c.fromPortId)?.device._id ?? "",
            target: portIndex.get(c.toPortId)?.device._id ?? "",
          }))
          .filter((e) => e.source && e.target),
      );

      const moved = Object.entries(layout);
      setNodes((prev) =>
        prev.map((n) => (layout[n.id] ? { ...n, position: layout[n.id] } : n)),
      );
      await Promise.all(
        moved.map(([id, position]) =>
          moveDevice({ id: id as Id<"deviceInstances">, position }),
        ),
      );
      window.setTimeout(() => void fitView({ padding: 0.15, duration: 400 }), 60);
      toast.success("Laid out along the signal path.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not arrange."));
    } finally {
      setArranging(false);
    }
  }, [canEdit, graph, getNodes, portIndex, setNodes, moveDevice, fitView]);

  /* ── Node drag persistence ─────────────────────────────────── */

  const handleNodesChange = React.useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === "position" && change.id) {
          if (change.dragging) draggingRef.current.add(change.id);
          else draggingRef.current.delete(change.id);
        }
        // A resized note has to keep its new size, and only the resize
        // handles produce this change, so there is nothing to debounce.
        if (
          change.type === "dimensions" &&
          change.resizing === false &&
          change.dimensions &&
          canEdit &&
          noteIds.has(change.id)
        ) {
          const { width, height } = change.dimensions;
          void updateNote({
            id: change.id as Id<"patchAnnotations">,
            size: { width, height },
          });
        }
      }
      onNodesChange(changes);
    },
    [onNodesChange, canEdit, updateNote, noteIds],
  );

  const persistPositions = React.useCallback(
    async (moved: Node[]) => {
      if (!canEdit || moved.length === 0) return;
      setSaveState("saving");
      try {
        await Promise.all(
          // A note and a device both moved, but they live in different tables.
          moved.map((n) =>
            n.type === "note"
              ? updateNote({ id: n.id as Id<"patchAnnotations">, position: n.position })
              : moveDevice({ id: n.id as Id<"deviceInstances">, position: n.position }),
          ),
        );
        setSaveState("saved");
        setSavedAt(Date.now());
      } catch {
        // Layout that silently reverts on the next reactive tick is worse
        // than an error, because the user cannot tell it happened.
        setSaveState("failed");
        toast.error("Could not save the new layout.");
      } finally {
        for (const n of moved) draggingRef.current.delete(n.id);
      }
    },
    [canEdit, moveDevice, updateNote],
  );

  /*
   * How fast the hand was moving when it let go. Sampled during the drag
   * because the stop event carries a position and no history, and a cable
   * that has to swing on release needs to know how much weight to throw.
   */
  const dragSampleRef = React.useRef<{ t: number; x: number; y: number } | null>(null);
  const dragVelocityRef = React.useRef({ vx: 0, vy: 0 });

  const trackDragVelocity = React.useCallback((node: Node) => {
    const now = performance.now();
    const prev = dragSampleRef.current;
    dragSampleRef.current = { t: now, x: node.position.x, y: node.position.y };
    if (!prev) return;
    const dt = (now - prev.t) / 1000;
    if (dt <= 0) return;
    // Smoothed, so one stuttered frame near the end does not decide the throw.
    const vx = (node.position.x - prev.x) / dt;
    const vy = (node.position.y - prev.y) / dt;
    dragVelocityRef.current = {
      vx: dragVelocityRef.current.vx * 0.45 + vx * 0.55,
      vy: dragVelocityRef.current.vy * 0.45 + vy * 0.55,
    };
  }, []);

  const releaseJolt = React.useCallback((dragged: Node[]) => {
    const { vx, vy } = dragVelocityRef.current;
    announceCableJolt(
      dragged.map((n) => n.id),
      vx,
      vy,
    );
    dragSampleRef.current = null;
    dragVelocityRef.current = { vx: 0, vy: 0 };
  }, []);

  const handleNodeDrag = React.useCallback(
    (_event: MouseEvent | TouchEvent, node: Node) => trackDragVelocity(node),
    [trackDragVelocity],
  );

  const handleSelectionDrag = React.useCallback(
    (_event: React.MouseEvent, dragged: Node[]) => {
      if (dragged[0]) trackDragVelocity(dragged[0]);
    },
    [trackDragVelocity],
  );

  const handleNodeDragStop = React.useCallback(
    async (_event: MouseEvent | TouchEvent, node: Node, dragged: Node[]) => {
      // Multi-select drags report every moved node, so persist all of them.
      const moved = dragged?.length ? dragged : [node];
      releaseJolt(moved);
      await persistPositions(moved);
    },
    [persistPositions, releaseJolt],
  );

  // Dragging a marquee selection routes through React Flow's selection rect,
  // which reports through onSelectionDrag* and never fires onNodeDragStop.
  // Without this the most natural way to tidy a rack looks like it worked and
  // is thrown away on the next server tick.
  const handleSelectionDragStart = React.useCallback((_event: React.MouseEvent, dragged: Node[]) => {
    for (const n of dragged) draggingRef.current.add(n.id);
  }, []);

  const handleSelectionDragStop = React.useCallback(
    async (_event: React.MouseEvent, dragged: Node[]) => {
      releaseJolt(dragged);
      await persistPositions(dragged);
    },
    [persistPositions, releaseJolt],
  );

  /* ── Right-click ────────────────────────────────────────────
     Everything here acts where you clicked, which is the whole
     reason a context menu beats a toolbar for this: "put a note
     HERE" has no toolbar equivalent that does not then make you
     drag the note to where you meant.
     ──────────────────────────────────────────────────────────── */

  const dropNote = React.useCallback(
    async (at: { x: number; y: number }, color = "amber") => {
      if (!canEdit) return;
      try {
        // Drop centred on the cursor rather than hanging off it.
        const id = await addNote({
          patchSpaceId,
          position: { x: at.x - NOTE_DEFAULT_SIZE.width / 2, y: at.y - NOTE_DEFAULT_SIZE.height / 2 },
          color,
        });
        pushHistory({
          label: "note",
          undo: async () => {
            await removeNote({ id: id as Id<"patchAnnotations"> });
          },
          redo: async () => {
            await addNote({ patchSpaceId, position: at, color });
          },
        });
      } catch (error) {
        toast.error(errorMessage(error, "Could not add a note."));
      }
    },
    [canEdit, addNote, removeNote, patchSpaceId, pushHistory],
  );

  const openPaneMenu = React.useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const items: MenuItem[] = [
        { kind: "label", label: "Add here" },
        {
          kind: "item",
          label: "Sticky note",
          disabled: !canEdit,
          onSelect: () => void dropNote(at),
        },
        {
          kind: "item",
          label: "Device from inventory",
          disabled: !canEdit,
          onSelect: () => {
            setPaletteCollapsed(false);
            toast("Pick the gear on the left, or drag it onto the canvas.");
          },
        },
        {
          kind: "item",
          label: "Build a custom device",
          disabled: !canEdit,
          onSelect: () => setCustomOpen(true),
        },
        { kind: "separator" },
        { kind: "label", label: "Canvas" },
        {
          kind: "item",
          label: "Tidy the layout",
          disabled: !canEdit,
          onSelect: () => void arrange(),
        },
        {
          kind: "item",
          label: "Fit on screen",
          shortcut: "f",
          onSelect: () => void fitView({ padding: 0.15, duration: 300 }),
        },
        {
          kind: "item",
          label: "Select every device",
          shortcut: "cmd+a",
          onSelect: () => setNodes((prev) => prev.map((n) => ({ ...n, selected: true }))),
        },
      ];
      setMenu({ x: event.clientX, y: event.clientY, items });
    },
    [screenToFlowPosition, canEdit, dropNote, setPaletteCollapsed, arrange, fitView, setNodes],
  );

  const openNodeMenu = React.useCallback(
    (event: MouseEvent | React.MouseEvent, node: Node) => {
      event.preventDefault();
      const isNote = node.type === "note";
      // Right-clicking something that is not selected should act on THAT
      // thing, not on whatever happened to be selected before.
      setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === node.id })));
      setEdges((prev) => prev.map((e) => ({ ...e, selected: false })));
      setSelectedIds({ nodes: [node.id], edges: [] });

      const items: MenuItem[] = isNote
        ? [
            { kind: "label", label: "Note colour" },
            ...NOTE_COLORS.map(
              (colour): MenuItem => ({
                kind: "item",
                label: colour.label,
                disabled: !canEdit,
                onSelect: () =>
                  void updateNote({ id: node.id as Id<"patchAnnotations">, color: colour.key }),
              }),
            ),
            { kind: "separator" },
            {
              kind: "item",
              label: "Delete note",
              danger: true,
              disabled: !canEdit,
              onSelect: () => void removeNote({ id: node.id as Id<"patchAnnotations"> }),
            },
          ]
        : [
            {
              kind: "item",
              label: "Edit properties",
              shortcut: "]",
              onSelect: () => setPropertiesCollapsed(false),
            },
            {
              kind: "item",
              label: trace ? "Stop tracing the signal path" : "Trace the signal path",
              onSelect: () => setTrace((on) => !on),
            },
            {
              kind: "item",
              label: "Add a note beside it",
              disabled: !canEdit,
              onSelect: () =>
                void dropNote({
                  x: node.position.x + 300,
                  y: node.position.y + NOTE_DEFAULT_SIZE.height / 2,
                }),
            },
            { kind: "separator" },
            {
              kind: "item",
              label: "Remove device",
              shortcut: "backspace",
              danger: true,
              disabled: !canEdit,
              onSelect: () => void deleteSelection(),
            },
          ];
      setMenu({ x: event.clientX, y: event.clientY, items });
    },
    [
      canEdit,
      setNodes,
      setEdges,
      updateNote,
      removeNote,
      dropNote,
      deleteSelection,
      setPropertiesCollapsed,
      trace,
      setTrace,
    ],
  );

  const openEdgeMenu = React.useCallback(
    (event: MouseEvent | React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setEdges((prev) => prev.map((e) => ({ ...e, selected: e.id === edge.id })));
      setNodes((prev) => prev.map((n) => ({ ...n, selected: false })));
      setSelectedIds({ nodes: [], edges: [edge.id] });
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            kind: "item",
            label: "Edit this run",
            shortcut: "]",
            onSelect: () => setPropertiesCollapsed(false),
          },
          { kind: "separator" },
          {
            kind: "item",
            label: "Pull the cable",
            danger: true,
            disabled: !canEdit,
            onSelect: () => void deleteSelection(),
          },
        ],
      });
    },
    [canEdit, setEdges, setNodes, deleteSelection, setPropertiesCollapsed],
  );

  /*
   * Selecting something opens the properties panel; clearing the selection
   * closes it again - but only if opening it was our idea. Someone who
   * deliberately pinned the panel open should not have it yanked shut the
   * moment they click empty canvas, so we remember who opened it.
   */
  const autoOpenedRef = React.useRef(false);
  const hasSelection = selectedIds.nodes.length > 0 || selectedIds.edges.length > 0;

  React.useEffect(() => {
    if (hasSelection && propertiesCollapsed) {
      autoOpenedRef.current = true;
      setPropertiesCollapsed(false);
      return;
    }
    if (!hasSelection && autoOpenedRef.current && !propertiesCollapsed) {
      autoOpenedRef.current = false;
      setPropertiesCollapsed(true);
    }
  }, [hasSelection, propertiesCollapsed, setPropertiesCollapsed]);

  /** Write the current layout again, whatever the canvas thinks it already did. */
  const flushLayout = React.useCallback(() => {
    if (!canEdit) return;
    void persistPositions(getNodes());
  }, [canEdit, persistPositions, getNodes]);

  /* ── Keyboard ──────────────────────────────────────────────── */

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Not every keydown target is an element - one dispatched at window or
      // document has no closest(), and calling it throws out of the handler,
      // taking every shortcut below with it.
      const raw = event.target;
      const target = raw instanceof HTMLElement ? raw : null;
      // Never hijack typing.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Nor act on the canvas while a dialog owns the screen. Backspace on a
      // focused button inside the custom-device dialog was raising a confirm
      // to delete devices the user could not even see.
      if (document.querySelector("[role='dialog'][data-state='open']")) return;
      if (target?.closest("[role='dialog']")) return;
      const meta = event.metaKey || event.ctrlKey;

      // Brackets fold the side panels, the way every canvas editor does it.
      if (!meta && (event.key === "[" || event.key === "]")) {
        event.preventDefault();
        if (event.key === "[") togglePalette();
        else toggleProperties();
        return;
      }

      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
        return;
      }
      if (meta && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setNodes((prev) => prev.map((n) => ({ ...n, selected: true })));
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void deleteSelection();
        return;
      }
      if (event.key === "Escape") {
        setNodes((prev) => prev.map((n) => ({ ...n, selected: false })));
        setEdges((prev) => prev.map((e) => ({ ...e, selected: false })));
          return;
      }
      if (event.key.toLowerCase() === "f") {
        void fitView({ padding: 0.2, duration: 300 });
        return;
      }
      // React Flow moves selected nodes on arrow keys without ever firing a
      // drag-stop, so the move has to be persisted here or it reverts.
      if (event.key.startsWith("Arrow") && canEdit) {
        window.setTimeout(() => {
          const selected = getNodes().filter((n) => n.selected);
          if (selected.length > 0) void persistPositions(selected);
        }, 0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    undo,
    redo,
    deleteSelection,
    fitView,
    setNodes,
    setEdges,
    canEdit,
    getNodes,
    persistPositions,
    togglePalette,
    toggleProperties,
  ]);

  /* ── Render ────────────────────────────────────────────────── */

  const loading = graph === undefined;

  return (
    <div
      className="grid h-full min-h-0 [transition:grid-template-columns_240ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
      style={{
        gridTemplateColumns: `${paletteCollapsed ? RAIL_WIDTH : "210px"} minmax(0,1fr) ${
          propertiesCollapsed ? RAIL_WIDTH : "280px"
        }`,
      }}
    >
      {paletteCollapsed ? (
        <PanelRail
          side="left"
          label="Inventory"
          shortcut="["
          onExpand={() => setPaletteCollapsed(false)}
        />
      ) : (
        <DevicePalette
          patchSpaceId={patchSpaceId}
          onPlaceEquipment={(item: PaletteItem) => place({ equipmentId: item._id })}
          onPlaceProfile={(profile: PaletteProfile) => place({ profileId: profile._id })}
          onCreateCustom={() => setCustomOpen(true)}
          onCollapse={() => setPaletteCollapsed(true)}
          disabled={!canEdit}
        />
      )}

      <div className="patch-canvas relative min-w-0">
        {/* Toolbar. Every control here is icon-only, so every control here
            has a tooltip naming it and its shortcut. */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-chrome border border-hairline-2 bg-coal/90 p-1 shadow-elev-3 backdrop-blur-sm">
          {/* Three ways to draw the same graph. Cable is the default because
              a studio reads a hanging loom faster than an abstraction. */}
          {(
            [
              {
                key: "cable" as const,
                icon: CableIcon,
                label: "Cables",
                hint: "Real cables with slack, hanging under their own weight and swinging when you move a rack.",
              },
              {
                key: "bubble" as const,
                icon: Spline,
                label: "Bubble",
                hint: "Clean curves. Friendly for quick session recall.",
              },
              {
                key: "schematic" as const,
                icon: GitBranch,
                label: "Schematic",
                hint: "Right-angle runs with lane separation. Reads as engineering documentation and holds up at high connection counts.",
              },
            ]
          ).map(({ key, icon: Icon, label, hint }) => (
            <Tooltip key={key} label={label} hint={hint}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${label} routing`}
                aria-pressed={mode === key}
                onClick={() => setMode(key)}
                className={cn(mode === key && "bg-gold/15 text-gold-bright")}
              >
                <Icon className="size-4" />
              </Button>
            </Tooltip>
          ))}

          <span className="mx-0.5 h-5 w-px bg-hairline-2" />

          <Tooltip
            label="Auto arrange"
            hint="Lays the room out along the signal path: sources left, monitors right, unpatched gear on a shelf underneath."
          >
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Auto arrange the layout"
                onClick={arrange}
                disabled={!canEdit || arranging || (graph?.devices.length ?? 0) === 0}
              >
                <LayoutGrid className="size-4" />
              </Button>
            </span>
          </Tooltip>

          <span className="mx-0.5 h-5 w-px bg-hairline-2" />

          <Tooltip
            label={
              connectionCount > ANIMATION_CONNECTION_LIMIT
                ? "Flow animation unavailable"
                : animationOn
                  ? "Signal flow animation on"
                  : "Signal flow animation off"
            }
            hint={
              connectionCount > ANIMATION_CONNECTION_LIMIT
                ? `Switched off automatically above ${ANIMATION_CONNECTION_LIMIT} runs to keep the canvas smooth. This space has ${connectionCount}.`
                : "Marches the dash from output toward input so direction reads at a glance."
            }
          >
            {/* A disabled button emits no pointer events, so the tooltip needs
                a wrapper to hang off. Otherwise the one case where the user
                most wants an explanation is the one case with no tooltip. */}
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Toggle signal flow animation"
                onClick={() => setAnimate((on) => !on)}
                disabled={connectionCount > ANIMATION_CONNECTION_LIMIT}
              >
                {animationOn ? <Zap className="size-4 text-gold" /> : <ZapOff className="size-4" />}
              </Button>
            </span>
          </Tooltip>

          <Tooltip
            label={trace ? "Signal trace on" : "Trace signal path"}
            hint="Select a device to light everything it feeds and everything feeding it, and dim the rest."
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Trace the signal path from the selection"
              aria-pressed={trace}
              onClick={() => setTrace((on) => !on)}
              className={cn(trace && "text-gold")}
            >
              <Route className="size-4" />
            </Button>
          </Tooltip>

          <span className="mx-0.5 h-5 w-px bg-hairline-2" />

          <Tooltip
            label="Undo"
            shortcut="cmd+z"
            hint={undoStack.length === 0 ? "Nothing to undo yet." : undefined}
          >
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Undo"
                onClick={undo}
                disabled={undoStack.length === 0}
              >
                <Undo2 className="size-4" />
              </Button>
            </span>
          </Tooltip>

          <Tooltip
            label="Redo"
            shortcut="cmd+shift+z"
            hint={redoStack.length === 0 ? "Nothing to redo." : undefined}
          >
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Redo"
                onClick={redo}
                disabled={redoStack.length === 0}
              >
                <Redo2 className="size-4" />
              </Button>
            </span>
          </Tooltip>

          <span className="mx-0.5 h-5 w-px bg-hairline-2" />

          <Tooltip label="Keyboard shortcuts" hint="Everything this canvas responds to.">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Keyboard shortcuts"
              onClick={() => setShortcutsOpen(true)}
            >
              <Keyboard className="size-4" />
            </Button>
          </Tooltip>
        </div>

        {/* While a cable is in the air, say what will happen when it lands. */}
        {connecting && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-chrome border border-gold-dim/60 bg-coal/95 px-3 py-1.5 font-meta text-[10px] uppercase tracking-wide text-gold-bright shadow-elev-3 backdrop-blur-sm">
            Drop on a glowing jack to patch · Esc to cancel
          </div>
        )}

        {/* Legend */}
        <Tooltip
          label="What is on this canvas"
          hint="Cables are coloured by jacket where one is recorded, and by signal level where none is."
          side="right"
        >
          <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 rounded-chrome border border-hairline-2 bg-coal/85 px-2.5 py-1.5 font-meta text-[9px] uppercase tracking-wide text-steel backdrop-blur-sm">
            <span className="flex items-center gap-1">
              <Waves className="size-2.5" />
              {connectionCount} run{connectionCount === 1 ? "" : "s"}
            </span>
            <span>{graph?.devices.length ?? 0} devices</span>
            {(graph?.annotations.length ?? 0) > 0 && (
              <span>
                {graph!.annotations.length} note{graph!.annotations.length === 1 ? "" : "s"}
              </span>
            )}
            {connectionCount > ANIMATION_CONNECTION_LIMIT && (
              <span className="text-caution">flow animation off for performance</span>
            )}
          </div>
        </Tooltip>

        {loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-steel">Loading the patch</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={handleNodesChange}
            onPaneContextMenu={openPaneMenu}
            onNodeContextMenu={openNodeMenu}
            onEdgeContextMenu={openEdgeMenu}
            onNodeDrag={handleNodeDrag}
            onSelectionDrag={handleSelectionDrag}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={handleNodeDragStop}
            onSelectionDragStart={handleSelectionDragStart}
            onSelectionDragStop={handleSelectionDragStop}
            onConnect={handleConnect}
            onSelectionChange={onSelectionChange}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const raw = event.dataTransfer.getData("application/pulse-patch");
              if (!raw) return;
              const parsed = JSON.parse(raw) as { kind: string; id: string };
              const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
              });
              void place(
                parsed.kind === "equipment"
                  ? { equipmentId: parsed.id as Id<"equipment"> }
                  : { profileId: parsed.id as Id<"deviceProfiles"> },
                position,
              );
            }}
            snapToGrid
            snapGrid={[GRID, GRID]}
            // The drop snaps from a good distance away, the way a real cable
            // finds its socket. This is in flow units, so at 35 percent zoom
            // it is still about 25 real pixels of forgiveness.
            connectionRadius={70}
            isValidConnection={isValidConnection}
            onConnectStart={() => setConnecting(true)}
            onConnectEnd={() => setConnecting(false)}
            minZoom={0.1}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            // Marquee on drag, pan with space or middle mouse. Right-drag is
            // deliberately not a pan gesture: binding it suppresses the
            // context menu on the pane and gives no way to offer our own.
            selectionOnDrag
            panOnDrag={[1]}
            panOnScroll
            selectNodesOnDrag={false}
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            // Deletion is handled above so it can confirm first.
            deleteKeyCode={null}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
          >
            {/* The app is near-black, which is the wrong surface for this
                one screen: a black cable jacket on a black canvas is
                invisible, and black is the commonest cable in any studio.
                React Flow paints its own background, so this has to be the
                prop rather than a stylesheet rule. */}
            <Background
              variant={BackgroundVariant.Dots}
              gap={GRID * 2}
              size={1}
              bgColor="#2b2b31"
              color="#4e4e57"
            />
<Panel position="bottom-right" className="!m-3">
              <div className="flex items-center gap-2">
                <SaveState
                  state={saveState}
                  savedAt={savedAt}
                  canEdit={canEdit}
                  onFlush={flushLayout}
                />
                <ZoomCluster />
              </div>
            </Panel>
            <MiniMap
              position="top-right"
              pannable
              zoomable
              // The library default is 200x150, which on a three-column
              // layout swallows a third of the canvas. An overview is worth
              // having; it is not worth that much of the drawing surface.
              style={{ width: 128, height: 92 }}
              className="!m-2 !rounded-chrome !border !border-hairline-2 !bg-coal/85"
              maskColor="rgba(8,8,10,0.66)"
              nodeColor={(node) =>
                (node.data as DeviceNodeData)?.traceDimmed ? "#2b2b32" : "#fdb913"
              }
            />
          </ReactFlow>
        )}

        {!loading && (graph?.devices.length ?? 0) === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="max-w-xs rounded-chrome border border-hairline-2 bg-coal/90 px-5 py-4 text-center shadow-elev-3">
              <p className="text-sm font-semibold text-bone">Nothing patched yet</p>
              <p className="mt-1 text-xs text-steel">
                Drag gear in from the left. Everything there is equipment this studio already owns.
              </p>
            </div>
          </div>
        )}
      </div>

      {propertiesCollapsed ? (
        <PanelRail
          side="right"
          label="Properties"
          shortcut="]"
          onExpand={() => setPropertiesCollapsed(false)}
        />
      ) : (
        <PropertiesPanel
          selection={selection}
          onDeleted={() => setSelectedIds({ nodes: [], edges: [] })}
          canEdit={canEdit}
          onCollapse={() => setPropertiesCollapsed(true)}
        />
      )}

      <CanvasContextMenu state={menu} onClose={closeMenu} />

      <CustomDeviceDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        onCreated={(profileId) => place({ profileId })}
      />

      <CablePickerDialog connectionId={askCableFor} onClose={() => setAskCableFor(null)} />

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <dl className="space-y-1.5">
              {SHORTCUTS.map((row) => (
                <div
                  key={row.keys}
                  className="flex items-center justify-between gap-4 rounded-md border border-hairline bg-coal-2/40 px-2.5 py-1.5"
                >
                  <dt className="text-xs text-bone">{row.what}</dt>
                  <dd>
                    <kbd className="rounded-[4px] border border-graphite/70 bg-coal px-1.5 py-0.5 font-meta text-[10px] font-semibold text-steel">
                      {prettyKeys(row.keys)}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PatchCanvas(props: { patchSpaceId: Id<"patchSpaces">; canEdit: boolean }) {
  return (
    <ReactFlowProvider>
      <PatchCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
