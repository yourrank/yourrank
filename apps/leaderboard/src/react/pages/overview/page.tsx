import * as React from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import type { HomeActions, HomeLiveItem, HomeSectionError, HomeViewModel } from "./types";

type HomeRoot = HTMLElement & { _openOverviewBrandDialog?: () => void };

function Retry({ error, actions }: { error: HomeSectionError; actions: HomeActions }) {
  return (
    <div className="ov-section-error" role="alert">
      <span>{error.message}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="btn btn--sm btn--ghost"
        data-home-retry={error.key}
        onClick={(event) => {
          event.preventDefault();
          actions.retry(error.key);
        }}
      >
        Retry
      </Button>
    </div>
  );
}

function LiveRow({ item }: { item: HomeLiveItem }) {
  return (
    <div className="ov-live-row" data-live={item.kind}>
      <div>
        <strong>{item.name}</strong>
        <span>{item.meta}</span>
      </div>
      <span className="ov-live-state">{item.status}</span>
      <a className="btn btn--sm" href={item.href}>{item.action}</a>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="ov-live-row ov-live-row--skeleton" aria-hidden="true">
      <div>
        <span className="skeleton v3-skel-line" />
        <span className="skeleton v3-skel-line v3-skel-line--short" />
      </div>
    </div>
  );
}

function PublicationLink({
  href,
  publicationAction,
  children,
  actions,
  className,
  onClick: onClickProp,
  includePublicationAction = false,
  brandAction = false,
  includeBrandAction = false,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  publicationAction?: boolean;
  includePublicationAction?: boolean;
  brandAction?: boolean;
  includeBrandAction?: boolean;
  actions: HomeActions;
}) {
  return (
    <a
      {...props}
      className={className}
      href={href}
      data-publication-action={includePublicationAction ? String(Boolean(publicationAction)) : publicationAction ? "true" : undefined}
      data-brand-action={includeBrandAction ? String(Boolean(brandAction)) : brandAction ? "true" : undefined}
      onClick={(event) => {
        if (publicationAction) {
          event.preventDefault();
          actions.publish();
          return;
        }
        onClickProp?.(event);
      }}
    >
      {children}
    </a>
  );
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function SetupStep({
  step,
  actions,
  onBrand,
}: {
  step: HomeViewModel["setup"]["steps"][number];
  actions: HomeActions;
  onBrand: (target: HTMLElement) => void;
}) {
  const content = (
    <>
      <span className={`ov-step-icon${step.complete ? " is-done" : ""}`} aria-hidden="true">{step.complete ? "✓" : ""}</span>
      <span className="ov-step-body"><b>{step.label}</b><span className="hint">{step.description}</span></span>
      <span className={`ov-step-status${step.complete ? " is-done" : ""}`} aria-hidden="true">{step.stateLabel}</span>
      <span className="sr-only">{step.stateLabel}</span>
    </>
  );

  if (step.ownerOnly) {
    return <li><span className={step.rowClass} data-setup-step={step.key} data-setup-state={step.stateKey}>{content}</span></li>;
  }
  if (step.key === "brand") {
    return (
      <li>
        <Button
          type="button"
          variant="ghost"
          className={step.rowClass}
          data-setup-step={step.key}
          data-setup-state={step.stateKey}
          data-brand-action="true"
          onClick={(event) => onBrand(event.currentTarget)}
        >
          {content}
        </Button>
      </li>
    );
  }
  return (
    <li>
      <PublicationLink
        className={step.rowClass}
        href={step.href}
        data-setup-step={step.key}
        data-setup-state={step.stateKey}
        publicationAction={step.publicationAction}
        actions={actions}
      >
        {content}
      </PublicationLink>
    </li>
  );
}

function BrandDialog({
  vm,
  actions,
  open,
  onOpenChange,
  initialTrigger,
}: {
  vm: HomeViewModel;
  actions: HomeActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTrigger: HTMLElement | null;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [name, setName] = React.useState(vm.header.siteName === "Checking…" ? "" : vm.header.siteName);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(vm.header.siteName === "Checking…" ? "" : vm.header.siteName);
    setError("");
  }, [open, vm.header.siteName, initialTrigger]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a site name.");
      inputRef.current?.focus();
      return;
    }
    setError("Saving…");
    setBusy(true);
    const result = await actions.saveBrandName(trimmed);
    if (result.ok) {
      setBusy(false);
      onOpenChange(false);
      return;
    }
    setBusy(false);
    setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-labelledby="brandNameTitle"
        className="modal-card block gap-0"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!initialTrigger) return;
          event.preventDefault();
          initialTrigger.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle asChild><h3 id="brandNameTitle">Name your site</h3></DialogTitle>
          <DialogDescription asChild><p>This is the name visitors see on your public page.</p></DialogDescription>
        </DialogHeader>
        <div className="field">
          <label htmlFor="brandNameInput">Site name</label>
          <input
            ref={inputRef}
            id="brandNameInput"
            maxLength={80}
            autoComplete="off"
            placeholder="Summer Race 2026"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
          />
        </div>
        <DialogFooter className="modal-actions">
          <Button type="button" variant="ghost" size="sm" className="btn btn--sm btn--ghost" data-brand="cancel" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="default" size="sm" className="btn btn--sm btn--accent" data-brand="save" onClick={() => void save()} disabled={busy} aria-busy={busy || undefined}>Save name</Button>
        </DialogFooter>
        <p className="status" id="brandNameErr" role="alert" aria-live="assertive">{error}</p>
      </DialogContent>
    </Dialog>
  );
}

export function HomePage({ root, vm, actions }: { root: HomeRoot; vm: HomeViewModel; actions: HomeActions }) {
  const [brandOpen, setBrandOpen] = React.useState(false);
  const [brandTrigger, setBrandTrigger] = React.useState<HTMLElement | null>(null);
  const [logoFailed, setLogoFailed] = React.useState(false);

  const openBrand = (target?: HTMLElement) => {
    setBrandTrigger(target || null);
    setBrandOpen(true);
  };

  React.useEffect(() => {
    root._openOverviewBrandDialog = () => openBrand();
    return () => {
      if (root._openOverviewBrandDialog) delete root._openOverviewBrandDialog;
    };
  }, [root]);

  React.useEffect(() => setLogoFailed(false), [vm.header.logoSrc]);

  return (
    <>
      <header className="v3-head ov-head v3-head--row">
        <div className="ov-identity">
          <span className="ov-avatar" aria-hidden="true">
            <img id="ovSiteLogo" alt="" hidden={!vm.header.logoSrc || logoFailed} src={vm.header.logoSrc || undefined} onError={() => setLogoFailed(true)} />
            <span id="ovSiteInitial" hidden={Boolean(vm.header.logoSrc) && !logoFailed}>{vm.header.initial}</span>
          </span>
          <div>
            <h1>Home</h1>
            <p className="ov-scope"><strong id="ovSiteName">{vm.header.siteName}</strong><span id="ovOperatorContext" hidden={vm.header.operatorHidden}>{vm.header.operatorText}</span></p>
            <p className="v3-head-sub" id="ovHeadSub">{vm.header.headSub}</p>
          </div>
        </div>
        <div className="ov-head-state">
          <span className="ov-status" id="ovStatus" data-state={vm.header.statusState}><i aria-hidden="true" /><span id="ovPublishedStatus">{vm.header.statusLabel}</span></span>
          <a className="ov-public-link" id="ovPublicLink" href={vm.header.publicHref} target="_blank" rel="noopener noreferrer" hidden={vm.header.publicHidden}>Open public page ↗</a>
        </div>
      </header>

      <section className="ov-operations ov-attention" id="ovAttention" aria-labelledby="ovAttentionTitle" role="region" aria-live="polite" aria-atomic="false" hidden={vm.attention.hidden}>
        <header className="ov-operations-head"><div><h2 id="ovAttentionTitle">Needs attention</h2><p>Problems that block members or visitors, with the fix for each.</p></div><span className="ov-operation-count" id="ovAttentionCount">{vm.attention.countText}</span></header>
        <div className="ov-attention-list" id="ovAttentionList">{vm.attention.items.map((item) => <div className="v3-alert v3-alert--warning ov-attention-row" data-attention={item.key} data-scope={item.scope} key={item.key}><span><b>{item.title}</b> <span>{item.why}</span></span><a className="btn btn--sm btn--ghost" href={item.href}>{item.action}</a></div>)}</div>
      </section>

      <section className="ov-operations ov-live" id="ovLiveNow" aria-labelledby="ovLiveNowTitle" data-home-section="live" hidden={vm.live.hidden} aria-busy={vm.live.busy || undefined}>
        <header className="ov-operations-head"><div><h2 id="ovLiveNowTitle">Live now</h2><p id="ovLiveNowSummary">{vm.live.summary}</p></div></header>
        <div className="ov-live-list" id="ovLiveNowList">{vm.live.items.map((item) => <LiveRow item={item} key={item.key} />)}{vm.live.loading && <SkeletonRow />}{vm.live.error && !vm.live.items.length && <Retry error={vm.live.error} actions={actions} />}</div>
      </section>

      <section className="ov-operations ov-coming-next" id="ovComingNext" aria-labelledby="ovComingNextTitle" data-home-section="upcoming" hidden={vm.upcoming.hidden} aria-busy={vm.upcoming.busy || undefined}>
        <header className="ov-operations-head"><div><h2 id="ovComingNextTitle">Coming next</h2><p>Scheduled for this community, soonest first.</p></div></header>
        <div className="ov-live-list" id="ovComingNextList">{vm.upcoming.items.map((item) => <div className="ov-live-row" data-upcoming={item.kind} key={item.key}><div><strong>{item.name}</strong><span>{item.meta}</span></div><time dateTime={item.at}>{item.formattedAt}</time><a className="btn btn--sm" href={item.href}>{item.action}</a></div>)}{vm.upcoming.loading && <SkeletonRow />}{vm.upcoming.error && !vm.upcoming.items.length && <Retry error={vm.upcoming.error} actions={actions} />}</div>
      </section>

      <section className="ov-pulse" id="ovPulse" aria-labelledby="ovPulseTitle" data-home-section="pulse" hidden={vm.pulse.hidden} aria-busy={vm.pulse.busy || undefined}>
        <div className="ov-list-head"><h2 id="ovPulseTitle">Community pulse</h2><span className="ov-pulse-range" id="ovPulseRange">{vm.pulse.rangeLabel}</span></div>
        <div className="ov-figures" id="ovFigures" aria-label="Community pulse">{vm.pulse.metrics.map((metric) => <div className="ov-figure" data-metric={metric.key} key={metric.key}><span className="ov-figure-lbl" id={`ovLbl_${metric.key}`}>{metric.label}</span><span className="ov-figure-val" id={`ovVal_${metric.key}`} aria-labelledby={`ovLbl_${metric.key}`} aria-busy={vm.pulse.status === "loading" || vm.pulse.status === "idle" || undefined}>{vm.pulse.status === "loading" || vm.pulse.status === "idle" ? <span className="skeleton v3-skel-kpi" aria-hidden="true" /> : vm.pulse.status === "ready" ? metric.value : "—"}</span></div>)}</div>
        <div className="ov-section-state" id="ovPulseState" hidden={!vm.pulse.error}>{vm.pulse.error && <Retry error={vm.pulse.error} actions={actions} />}</div>
      </section>

      <section className="ov-list ov-recent" aria-labelledby="ovActivityTitle" id="ovRecent" data-home-section="recent" hidden={vm.recent.hidden} aria-busy={vm.recent.busy || undefined}>
        <div className="ov-list-head"><h2 id="ovActivityTitle">Recent activity</h2><a className="ov-list-link" id="ovActivityAllLink" href={vm.recent.allHref}>All activity</a></div>
        <div className="ov-activity-list" id="ovActivityList">{vm.recent.events.map((event, index) => <div className="ov-activity-row" data-event={event.kind} key={`${event.kind}-${event.at}-${index}`}><span className="ov-activity-icon"><ActivityIcon /></span><span className="ov-activity-copy"><b>{event.title}</b><span>{event.detail || ""}</span></span><time dateTime={event.at} title={event.formattedAt}>{event.relative}</time></div>)}{vm.recent.loading && <><SkeletonRow /><SkeletonRow /></>}</div>
        <div className="ov-section-state" id="ovActivityEmpty" hidden={!vm.recent.empty && !vm.recent.error}>{vm.recent.error ? <Retry error={vm.recent.error} actions={actions} /> : vm.recent.empty && <div className="v3-empty v3-empty--compact-heading"><h2>{vm.recent.empty.title}</h2><p>{vm.recent.empty.body}</p></div>}</div>
      </section>

      <section className="ov-quick" id="ovQuickActions" aria-labelledby="ovQuickActionsTitle">
        <div className="ov-list-head"><h2 id="ovQuickActionsTitle">Quick actions</h2></div>
        <div className="ov-quick-grid" id="ovQuickActionsList">{vm.quickActions.map((action) => <a className="ov-quick-action" data-quick={action.key} href={action.href} key={action.key}>{action.label}</a>)}</div>
      </section>

      <section className={`ov-setup${vm.setup.attention ? " is-attention" : ""}`} id="ovSetup" aria-labelledby="ovSetupTitle" hidden={vm.setup.hidden}>
        <div className="ov-setup-head"><div><h2 id="ovSetupTitle">{vm.setup.title}</h2><p id="ovSetupMessage">{vm.setup.message}</p></div><PublicationLink className="btn btn--accent" id="ovSetupAction" href={vm.setup.action.href} hidden={vm.setup.action.hidden} publicationAction={vm.setup.action.publicationAction} brandAction={vm.setup.action.brandAction} includePublicationAction includeBrandAction actions={actions} onClick={(event) => { if (vm.setup.action.brandAction) { event.preventDefault(); openBrand(event.currentTarget); } }}>{vm.setup.action.label}</PublicationLink></div>
        <details className="ov-setup-details"><summary>Core setup <span className="ov-setup-count" id="ovSetupCount">{vm.setup.countText}</span></summary><ul className="ov-setup-list" id="ovSetupList" aria-label="Setup steps">{vm.setup.steps.map((step) => <SetupStep step={step} actions={actions} onBrand={openBrand} key={step.key} />)}</ul></details>
      </section>

      <BrandDialog vm={vm} actions={actions} open={brandOpen} onOpenChange={setBrandOpen} initialTrigger={brandTrigger} />
    </>
  );
}
