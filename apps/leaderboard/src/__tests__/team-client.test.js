import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../assets/account.js", import.meta.url), "utf8");
const teamSource = source.slice(source.indexOf("function renderTeam("), source.indexOf("function wireTeam("));

function setup({ request = async () => ({ ok: false, data: {} }), confirm = async () => false, search = "", activeSiteId = "" } = {}) {
  const elements = new Map();
  const buttons = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: "", innerHTML: "" });
    return elements.get(id);
  };
  const document = {
    querySelectorAll(selector) {
      if (!buttons.has(selector)) buttons.set(selector, {
        getAttribute: () => 'fixture-target',
        addEventListener(_type, callback) { this.click = callback; },
      });
      return [buttons.get(selector)];
    },
  };
  const run = new Function("$", "document", "jsonReq", "showConfirmModal", "state", "location", "esc", "fmtDateTime", "setStatus", "copyToClipboard", "flashButton", `
    let teamSiteId = "", teamSiteName = "", teamLoadVersion = 0;
    ${teamSource}
    return { renderTeam, loadTeam, leave: () => { teamLoadVersion++; } };
  `);
  const client = run($, document, request, confirm, { ACTIVE_SITE_ID: activeSiteId }, { search }, String, String, () => {}, async () => {}, () => {});
  return { ...client, $, button: (selector) => buttons.get(selector) };
}

const team = (siteId, name, role = 'owner') => ({
  ok: true, siteId, siteName: name, currentRole: role, canManageTeam: role === 'owner',
  members: [{ userId: 'fixture-target', email: 'helper@example.test', role: 'moderator' }],
  invites: [{ id: 'fixture-target', email: 'invite@example.test' }],
  seats: { plan: 'team', used: 3, limit: 5 },
});

describe('Team client scope and recovery', () => {
  it('shows the authorized site name, pooled seats and Moderator read-only state', () => {
    const client = setup();
    client.renderTeam(team('alpha', 'Atlas Community', 'moderator'));
    expect(client.$('teamSiteName').textContent).toBe('Atlas Community');
    expect(client.$('teamSeatUsage').textContent).toBe('3 of 5 team seats');
    expect(client.$('teamReadOnlyNotice').hidden).toBe(false);
    expect(client.$('btnOpenInviteModal').hidden).toBe(true);
    expect(client.$('teamPendingSection').hidden).toBe(true);
    expect(client.$('teamMembersList').innerHTML).not.toContain('team-remove-btn');
  });

  for (const [selector, endpoint] of [['.team-remove-btn', '/api/site/team/remove'], ['.team-revoke-invite-btn', '/api/site/team/invite/revoke']]) {
    it(`keeps the confirmed site when another team renders during ${endpoint}`, async () => {
      let resolveConfirmation;
      const calls = [];
      const client = setup({
        confirm: async (_title, description) => {
          expect(description).toContain('Atlas Community');
          return new Promise(resolve => { resolveConfirmation = resolve; });
        },
        request: async (...args) => { calls.push(args); return { ok: false, data: {} }; },
      });
      client.renderTeam(team('alpha', 'Atlas Community'));
      const pending = client.button(selector).click();
      client.renderTeam(team('beta', 'Rif Community'));
      resolveConfirmation(true);
      await pending;
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toBe(endpoint);
      expect(calls[0][2].siteId).toBe('alpha');
    });
  }

  it('prefers an explicit site URL and clears stale controls after a failed request', async () => {
    const calls = [];
    const client = setup({ search: '?siteId=beta', activeSiteId: 'alpha', request: async (...args) => { calls.push(args); throw new Error('offline'); } });
    client.renderTeam(team('alpha', 'Atlas Community'));
    await client.loadTeam();
    expect(calls[0][1]).toBe('/api/site/team?siteId=beta');
    expect(client.$('teamSiteName').textContent).toBe('site unavailable');
    expect(client.$('btnOpenInviteModal').hidden).toBe(true);
    expect(client.$('teamSeatUsage').textContent).toBe('Operator seats unavailable');
  });

  it('does not render a response that arrives after leaving the settings page', async () => {
    let resolveRequest;
    const client = setup({ request: () => new Promise(resolve => { resolveRequest = resolve; }) });
    const pending = client.loadTeam();
    client.leave();
    resolveRequest({ ok: true, data: team('alpha', 'Atlas Community') });
    await pending;
    expect(client.$('teamSiteName').textContent).toBe('');
  });
});
