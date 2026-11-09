import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Workspace } from '@/features/workspace/Workspace';
import { isWorkflowSlug, WORKFLOWS, workflowPath } from '@/features/workspace/workflows';
import { useHome, useHomeActions, type WindowKind } from '@/state/home';
import { NotFoundPage } from './NotFoundPage';

/**
 * Keeps the URL and the active window in step: entering `/{workflow}` opens (or focuses) that workflow's window, and focusing a
 * window shows its workflow in the address bar (`replace`, so the history is not flooded by window switches). Home = `/`.
 */
export function WorkspacePage() {
  const { workflow } = useParams();
  const navigate = useNavigate();
  const { windows, activeId } = useHome();
  const { open, activate } = useHomeActions();
  const activeKind = windows.find((w) => w.id === activeId)?.kind ?? null;
  const valid = workflow === undefined || isWorkflowSlug(workflow);

  // URL → window. Only reacts to a changed slug, so it never fights the window → URL effect below.
  const lastSlug = useRef<string | undefined>(undefined);
  // The window the URL asked for, until the reducer has made it active (so the effect below does not navigate away first).
  const pendingKind = useRef<WindowKind | null>(null);
  useEffect(() => {
    if (workflow === lastSlug.current) return;
    lastSlug.current = workflow;
    if (!isWorkflowSlug(workflow)) return;
    const kind = WORKFLOWS[workflow];
    if (activeKind === kind) return;
    const existing = windows
      .filter((w) => w.kind === kind)
      .reduce<
        (typeof windows)[number] | null
      >((a, b) => (!a || b.lastUsed > a.lastUsed ? b : a), null);
    pendingKind.current = kind;
    if (existing) activate(existing.id);
    else open(kind);
  }, [workflow, activeKind, windows, open, activate]);

  // Window → URL.
  useEffect(() => {
    if (!valid) return;
    if (pendingKind.current) {
      if (activeKind !== pendingKind.current) return;
      pendingKind.current = null;
    }
    const path = workflowPath(activeKind);
    const current = workflow ? `/${workflow}` : '/';
    if (path !== current) {
      lastSlug.current = path === '/' ? undefined : path.slice(1);
      navigate(path, { replace: true });
    }
  }, [activeKind, workflow, valid, navigate]);

  if (!valid) return <NotFoundPage />;
  return <Workspace />;
}
