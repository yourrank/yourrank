// commands dashboard page panels
export function commandsPanel(): string {
  return `
  <div class="lb-bento" data-page="commands">
    <div class="lb-widget lb-widget--full" id="commandsEmptyHint">
      <div class="mb-md"><h2>Commands</h2></div>
      <p class="muted">Connect Telegram first, then choose what your bot replies. <a href="/dashboard/telegram/bots">Connect Telegram</a></p>
    </div>

    <div class="lb-widget lb-widget--full" id="customizePanel">
      <div class="d-flex justify-between items-center mb-md">
        <h2>Welcome message</h2>
        <p class="muted text-sm m-0" id="selectedBotName">No bot selected</p>
      </div>
      
      <div class="d-flex flex-col gap-8 mb-md command-bot-field">
        <label for="botSelect" class="muted text-xs">Bot</label>
        <select id="botSelect" class="v3-input"><option value="">Loading bots…</option></select>
      </div>
      
      <div id="custDisabledNote" class="v3-note hidden">This bot is disconnected. Reconnect it before editing replies.</div>
      <p class="muted text-sm mb-md">The first thing a new subscriber receives when they start a chat with this bot.</p>
      
      <div class="d-flex flex-col gap-8 welcome-message-field">
        <label for="welcomeMsg" class="muted text-xs">Welcome message</label>
        <textarea id="welcomeMsg" class="v3-input" rows="2" placeholder="Leave blank to use the default greeting"></textarea>
        <div>
          <button class="btn btn--accent" data-action="saveWelcome" type="button">Save welcome message</button>
        </div>
      </div>

      <hr class="v3-divider my-lg" />

      <div class="mb-md"><h2>Your commands</h2></div>
      <p class="muted text-sm mb-md">A command is a shortcut your subscribers type to get a reply. Add one, give it a reply, and it works right away. Built-in shortcuts such as start, code and subscribe are reserved.</p>
      
      <div class="d-flex flex-wrap gap-12 command-form-row">
        <div class="d-flex flex-col gap-4 flex-1 command-form-field">
          <label class="sr-only" for="cmdName">Command</label>
          <input class="v3-input" id="cmdName" placeholder="Command (e.g. vip)">
        </div>
        <div class="d-flex flex-col gap-4 flex-1 command-form-field">
          <label class="sr-only" for="cmdResp">Reply</label>
          <input class="v3-input" id="cmdResp" placeholder="Reply text subscribers receive">
        </div>
      </div>
      <div class="d-flex flex-wrap gap-12 mt-sm command-form-row">
        <div class="d-flex flex-col gap-4 flex-1 command-form-field">
          <label class="sr-only" for="cmdBtnLabel">Button label</label>
          <input class="v3-input" id="cmdBtnLabel" placeholder="Button label (optional)">
        </div>
        <div class="d-flex flex-col gap-4 flex-1 command-form-field">
          <label class="sr-only" for="cmdBtnUrl">Button URL</label>
          <div class="d-flex gap-8">
            <input class="v3-input command-button-url" id="cmdBtnUrl" type="url" placeholder="https://example.com (optional)">
            <button class="btn btn--ghost btn--icon" data-action="addCommandButton" type="button" aria-label="Add button">+</button>
          </div>
        </div>
      </div>
      
      <div id="cmdButtonList" class="cmd-button-list mt-sm"></div>
      <div class="mt-md">
        <button class="btn btn--outline" data-action="addCommand" type="button">Add command</button>
      </div>
      <p class="muted text-xs mt-sm">View a command to read its full reply, or send yourself a test copy.</p>

      <div id="cmdPreview" class="bg-panel border radius-md p-16 mt-md" hidden>
        <div class="mb-sm"><h3>What subscribers see</h3></div>
        <p class="mb-sm"><b id="cmdPreviewName">/</b></p>
        <pre id="cmdPreviewResponse" class="v3-input font-mono text-sm mb-md command-preview-response"></pre>
        <div class="d-flex flex-wrap gap-8">
          <label class="sr-only" for="cmdTestChatId">Chat ID</label>
          <input class="v3-input" id="cmdTestChatId" inputmode="numeric" placeholder="Your chat ID">
          <button class="btn btn--accent" data-action="testCommand" type="button">Send test</button>
          <button class="btn btn--ghost" data-action="closeCommandPreview" type="button">Close</button>
        </div>
      </div>

      <div class="v3-table-scroll mt-lg">
        <table class="v3-table">
          <thead><tr><th>Command</th><th>Reply</th><th>Buttons</th><th>State</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody id="cmdList"><tr><td colspan="5" class="muted">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>`;
}
