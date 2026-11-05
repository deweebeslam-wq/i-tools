// The interactive part of the public site. Talks only to Supabase, whose rules decide what each visitor may do.
// Everything people typed goes on screen through textContent, never as HTML, so nobody's text can run as code.
(function () {
    const root = document.documentElement.dataset.root;
    const cfg = window.HUB_CONFIG;
    const mount = document.getElementById("live");
    const view = mount?.dataset.view;
    const params = new URLSearchParams(location.search);

    const FAMILIES = ["i-Tools for Revit", "i-Navis", "i-Civil"];
    const KINDS = [
        ["New Tool", "Something that doesn't exist yet"],
        ["New Feature", "A new ability for an existing tool"],
        ["Improvement", "Make something that exists work better"],
        ["Automation Request", "Stop doing a task by hand"],
        ["Integration Request", "Connect tools or software together"]
    ];
    const CATEGORIES = ["Installation Issue", "UI/UX Issue", "Functionality Issue", "Performance Issue", "Compatibility Issue", "Data / Calculation Issue", "Crash / Exception", "Other"];
    const REQUEST_STATUS = { ideas: ["Ideas / Backlog", "st-waiting"], research: ["Research", "st-looking"], planned: ["Planned", "st-decided"], in_development: ["In Development", "st-building"], testing: ["Testing / QA", "st-checking"], ready: ["Ready for Release", "st-checking"], released: ["Released", "st-done"], on_hold: ["On Hold", "st-stopped"], rejected: ["Rejected", "st-stopped"] };
    const BUG_STATUS = { submitted: ["Submitted", "st-waiting"], under_review: ["Under Review", "st-looking"], confirmed: ["Confirmed", "st-decided"], in_progress: ["In Progress", "st-building"], fixed: ["Fixed", "st-done"], testing: ["Testing", "st-checking"], closed: ["Closed", "st-done"], on_hold: ["On Hold", "st-stopped"], rejected: ["Rejected", "st-stopped"] };
    const statusesOf = type => type === "bug" ? BUG_STATUS : REQUEST_STATUS;
    const statusName = (type, status) => statusesOf(type)[status]?.[0] ?? status;

    const AUTHOR = "author:profiles!items_author_id_fkey(id, display_name, role)";
    const LIST_COLUMNS = `id, code, type, kind, title, family, tool, status, is_public, vote_count, comment_count, created_at, ${AUTHOR}`;
    // shortcut: shows the newest 300, fine for now; add paging if the board ever grows past that.
    const LIST_LIMIT = 300;

    function h(tag, attrs, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs ?? {})) {
            if (v === null || v === undefined || v === false) continue;
            if (k === "class") el.className = v;
            else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
            else if (k === "value") el.value = v;
            else if (v === true) el.setAttribute(k, "");
            else el.setAttribute(k, v);
        }
        for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
        return el;
    }
    const link = (path, text, cls) => h("a", { href: root + path, class: cls }, text);
    const day = iso => iso.slice(0, 10);
    const when = iso => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const badge = (type, status, name) => h("span", { class: "status live-status " + (statusesOf(type)[status]?.[1] ?? "st-unknown") }, name ?? statusName(type, status));
    const familyMark = name => h("span", { class: "family fam-" + ({ "i-Tools for Revit": "revit", "i-Navis": "navis", "i-Civil": "civil" }[name] ?? "other") }, name);
    const empty = (title, text, ...actions) => h("div", { class: "empty" }, h("strong", null, title), text ? h("span", null, text) : null, actions.length ? h("div", { class: "form-actions" }, actions) : null);
    const loading = () => h("div", { role: "status", "aria-label": "Loading" }, h("span", { class: "skeleton skeleton-head" }), h("span", { class: "skeleton", style: "width:55%" }), h("span", { class: "skeleton tall" }));
    function show(...nodes) { mount.replaceChildren(...nodes.flat().filter(Boolean)); }

    // Our own rule messages are written for people. Anything else is a technical message, so don't show it.
    function explain(error) {
        const message = String(error?.message ?? "");
        if (error?.code === "P0001") return message;
        if (error?.code === "42501" || /row-level security/i.test(message)) return "You don't have permission to do that.";
        if (/JWT|session/i.test(message)) return "Your sign-in has expired. Please sign in again.";
        if (/Failed to fetch|NetworkError/i.test(message)) return "The site could not be reached. Check your connection and try again.";
        return "That could not be saved. Please try again.";
    }

    if (!cfg || !window.supabase) {
        if (mount) show(empty("Accounts aren't switched on yet", "This part of the site will open soon. You can still browse the tools and downloads."));
        return;
    }

    const sb = window.supabase.createClient(cfg.url, cfg.key);
    let session = null, me = null;

    async function loadMe() {
        const { data } = await sb.auth.getSession();
        session = data.session;
        me = null;
        if (session) {
            const profile = await sb.from("profiles").select("id, display_name, role").eq("id", session.user.id).maybeSingle();
            me = profile.data ?? { id: session.user.id, display_name: "Member", role: "member" };
        }
        const slot = document.getElementById("auth-slot");
        if (slot) slot.replaceChildren(me ? link("account/index.html", me.display_name, "button") : link("account/index.html", "Sign in", "button primary"));
        const team = document.getElementById("nav-team");
        if (team) team.hidden = !isTeam();
    }
    const isTeam = () => me?.role === "team" || me?.role === "admin";

    function signInFirst(what, next) {
        return empty(`Sign in to ${what}`, "It takes a minute, and you can then follow what you send.", link(`account/index.html?next=${encodeURIComponent(next)}`, "Sign in or create an account", "button primary"));
    }

    function field(label, control, help, optional) {
        return h("div", { class: "field" }, h("label", null, h("span", { class: "field-label" }, label, optional ? h("span", { class: "optional" }, " (optional)") : null), control), help ? h("small", { class: "help" }, help) : null);
    }
    const input = (name, attrs) => h("input", { name, autocomplete: "off", ...attrs });
    const area = (name, rows, attrs) => h("textarea", { name, rows, ...attrs });
    const select = (name, options, attrs) => h("select", { name, ...attrs }, options.map(o => Array.isArray(o) ? h("option", { value: o[0] }, o[1]) : h("option", { value: o }, o)));
    const message = () => h("div", { class: "validation-message", role: "alert", hidden: true });
    const setMessage = (el, text) => { el.textContent = text ?? ""; el.hidden = !text; };

    // Account
    function nextPage() {
        const next = params.get("next") ?? "";
        // Only pages of this site, so a crafted link can't send someone elsewhere after sign-in.
        return /^(submit|report|item|community|team)\/index\.html(\?[\w=&%+.-]*)?$/.test(next) ? next : null;
    }

    function renderAccount(mode = "in") {
        if (me && mode !== "reset") return renderProfile();
        const error = message();
        const note = h("div", { class: "hint", role: "status", hidden: true });
        const email = input("email", { type: "email", required: true, autocomplete: "email" });
        const password = input("password", { type: "password", required: true, minlength: 8, autocomplete: mode === "up" || mode === "reset" ? "new-password" : "current-password" });
        const name = input("name", { required: true, maxlength: 60, autocomplete: "name" });
        const titles = { in: "Sign in", up: "Create an account", forgot: "Reset your password", reset: "Choose a new password" };
        const submit = async e => {
            e.preventDefault();
            setMessage(error);
            const button = e.target.querySelector("button[type=submit]");
            button.disabled = true;
            try {
                if (mode === "in") {
                    const r = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
                    if (r.error) throw new Error(/confirm/i.test(r.error.message) ? "Confirm your email first, using the link we sent you." : "That email and password don't match.");
                    await loadMe();
                    const next = nextPage();
                    if (next) location.href = root + next; else renderAccount();
                } else if (mode === "up") {
                    const r = await sb.auth.signUp({ email: email.value.trim(), password: password.value, options: { data: { display_name: name.value.trim() }, emailRedirectTo: new URL(root + "account/index.html", location.href).href } });
                    if (r.error) throw new Error(/already registered|already exists/i.test(r.error.message) ? "This email already has an account. Press \"I have an account\" below to sign in." : /sending.*email|email.*sending/i.test(r.error.message) ? "The confirmation email could not be sent. Please try again later." : /rate limit/i.test(r.error.message) ? "Too many sign-ups right now. Please try again later." : /password/i.test(r.error.message) ? "Choose a stronger password of at least 8 characters." : "That account could not be created. Check the email address and try again.");
                    await loadMe();
                    if (me) { const next = nextPage(); if (next) location.href = root + next; else renderAccount(); }
                    else { note.textContent = "Check your email and press the link in it to finish. It may take a minute."; note.hidden = false; }
                } else if (mode === "forgot") {
                    const r = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: new URL(root + "account/index.html", location.href).href });
                    if (r.error && /rate limit/i.test(r.error.message)) throw new Error("Too many requests right now. Please try again later.");
                    // The same answer either way, so this can't be used to find out who has an account.
                    note.textContent = "If that email has an account, a reset link is on its way.";
                    note.hidden = false;
                } else {
                    const r = await sb.auth.updateUser({ password: password.value });
                    if (r.error) throw new Error("That password could not be saved. Use at least 8 characters.");
                    await loadMe();
                    renderAccount();
                }
            } catch (ex) {
                setMessage(error, ex.message);
            }
            button.disabled = false;
        };
        const form = h("form", { class: "card form form-account", onsubmit: submit },
            mode === "up" ? field("Your name or team", name, "Shown next to what you post. Don't use your email.") : null,
            mode !== "reset" ? field("Email", email, mode === "up" ? "Never shown to other people." : null) : null,
            mode !== "forgot" ? field(mode === "reset" ? "New password" : "Password", password, mode === "in" ? null : "At least 8 characters.") : null,
            error, note,
            h("div", { class: "form-actions" }, h("button", { type: "submit", class: "button primary" }, { in: "Sign in", up: "Create account", forgot: "Send reset link", reset: "Save password" }[mode])),
            h("p", { class: "account-links" },
                mode !== "in" && mode !== "reset" ? h("button", { type: "button", class: "link-button", onclick: () => renderAccount("in") }, "I have an account") : null,
                mode === "in" ? h("button", { type: "button", class: "link-button", onclick: () => renderAccount("up") }, "Create an account") : null,
                mode === "in" ? h("button", { type: "button", class: "link-button", onclick: () => renderAccount("forgot") }, "Forgot password") : null));
        show(pageHead(titles[mode], mode === "up" ? "An account lets you send requests and bugs, comment, vote, and follow what you sent." : null), form);
    }

    function pageHead(title, lead, ...actions) {
        document.title = title + " | i-Tools";
        return h("header", { class: "page-head" }, h("div", null, h("h1", { class: "wrap-any" }, title), lead ? h("p", { class: "page-lead" }, lead) : null), actions.length ? h("div", { class: "page-actions" }, actions) : null);
    }

    function itemRows(items, emptyNode) {
        if (!items.length) return emptyNode;
        return h("div", { class: "table-wrap" }, h("table", { class: "item-table mobile-stack" },
            h("thead", null, h("tr", null, ["ID", "Title", "Family", "Status", "Votes", "Comments", "Sent"].map(t => h("th", null, t)))),
            h("tbody", null, items.map(i => h("tr", null,
                h("td", { "data-label": "ID" }, link(`item/index.html?id=${i.id}`, i.code, "code")),
                h("td", { "data-label": "Title", class: "wrap-any" }, i.title, i.is_public ? null : h("span", { class: "tag live-private" }, "Private")),
                h("td", { "data-label": "Family" }, familyMark(i.family)),
                h("td", { "data-label": "Status" }, badge(i.type, i.status)),
                h("td", { "data-label": "Votes" }, i.vote_count ? String(i.vote_count) : ""),
                h("td", { "data-label": "Comments" }, i.comment_count ? String(i.comment_count) : ""),
                h("td", { "data-label": "Sent", class: "nowrap" }, day(i.created_at)))))));
    }

    async function renderProfile() {
        const name = input("name", { required: true, maxlength: 60, value: me.display_name });
        const saved = h("div", { class: "validation-message", role: "alert", hidden: true });
        const form = h("form", { class: "inline-action", onsubmit: async e => {
            e.preventDefault();
            const value = name.value.trim();
            if (!value) return setMessage(saved, "Enter a name.");
            const r = await sb.from("profiles").update({ display_name: value }).eq("id", me.id);
            if (r.error) return setMessage(saved, explain(r.error));
            await loadMe();
            setMessage(saved);
            renderProfile();
        } }, h("label", null, h("span", { class: "field-label" }, "Name shown on your posts"), name), h("button", { type: "submit", class: "button" }, "Save name"));
        const signOut = h("button", { type: "button", class: "button", onclick: async () => { await sb.auth.signOut(); await loadMe(); renderAccount(); } }, "Sign out");
        const list = h("div", null, loading());
        show(pageHead("My account", `Signed in as ${session.user.email}. Your email is never shown to other people.`, signOut),
            h("section", { class: "panel" }, form, saved),
            h("section", { class: "panel" }, h("h2", null, "What I sent"), list));
        const r = await sb.from("items").select(LIST_COLUMNS).eq("author_id", me.id).order("created_at", { ascending: false });
        list.replaceChildren(r.error ? h("p", { class: "validation-message" }, explain(r.error))
            : itemRows(r.data, empty("You haven't sent anything yet", null, link("submit/index.html", "Submit a request", "button"), link("report/index.html", "Report a bug", "button"))));
    }

    // Forms
    function familyAndTool(toolLabel, toolHelp, required) {
        const family = select("family", [["", "Choose…"], ...FAMILIES], { required: true });
        const tool = select("tool", [["", required ? "Choose…" : "None"]], { disabled: true, required });
        const fill = () => {
            const names = window.HUB_INDEX.filter(x => x.group === "Tools" && x.detail === family.value).map(x => x.title).sort();
            tool.replaceChildren(h("option", { value: "" }, required ? "Choose…" : "None"), ...names.map(n => h("option", { value: n }, n)), required ? h("option", { value: "Not listed" }, "Not listed") : null);
            tool.disabled = !family.value;
        };
        family.addEventListener("input", fill);
        const wantTool = params.get("tool");
        const entry = window.HUB_INDEX.find(x => x.group === "Tools" && x.title === wantTool);
        if (entry) { family.value = entry.detail; fill(); tool.value = entry.title; }
        return { family, tool, row: [field("Product family", family, "Choose the family it fits best."), field(toolLabel, tool, toolHelp, !required)] };
    }

    function submitForm(title, lead, signInWhat, here, build) {
        if (!me) return show(pageHead(title, lead), signInFirst(signInWhat, here));
        const error = message();
        const { parts, read, label } = build();
        const button = h("button", { type: "submit", class: "button primary" }, label);
        const form = h("form", { class: "card form form-sheet", onsubmit: async e => {
            e.preventDefault();
            setMessage(error);
            const values = read();
            if (values.problem) return setMessage(error, values.problem);
            button.disabled = true;
            const r = await sb.from("items").insert(values.row).select("id, code, title").single();
            button.disabled = false;
            if (r.error) return setMessage(error, explain(r.error));
            show(h("div", { class: "card success" },
                h("h1", null, "Thank you, we received it"),
                h("p", { class: "item-code" }, r.data.code),
                h("p", { class: "wrap-any" }, r.data.title),
                h("p", { class: "muted" }, "Keep this ID to refer to it. Only you and the team can see it until the team publishes it."),
                h("div", { class: "form-actions" }, link(`item/index.html?id=${r.data.id}`, "View it", "button primary"), link("account/index.html", "What I sent", "button"), link("index.html", "Overview", "button"))));
        } }, h("p", { class: "hint" }, "Don't include client names, project names or anything confidential. If the team publishes this, everyone can read it, with your name."), parts, error, h("div", { class: "form-actions" }, button));
        show(pageHead(title, lead), form);
    }

    const clean = v => { const t = v.trim(); return t === "" ? null : t; };

    function renderSubmit() {
        submitForm("Submit a request", "Tell us what you need. You get an ID to follow it.", "submit a request", "submit/index.html", () => {
            let kind = KINDS.some(k => k[0] === params.get("kind")) ? params.get("kind") : null;
            const choices = h("div", { class: "choice-grid", role: "radiogroup", "aria-label": "Submission type" });
            const drawChoices = () => choices.replaceChildren(...KINDS.map(([k, text]) => h("button", { type: "button", class: "choice" + (k === kind ? " selected" : ""), role: "radio", "aria-checked": k === kind ? "true" : "false", onclick: () => { kind = k; drawChoices(); } }, h("strong", null, k), h("span", null, text))));
            drawChoices();
            const where = familyAndTool("Related tool", "Leave empty for something new.", false);
            const title = input("title", { required: true, minlength: 5, maxlength: 150 });
            const description = area("description", 4, { required: true, maxlength: 8000 });
            const problem = area("problem", 3, { required: true, maxlength: 8000 });
            const expected = area("expected", 3, { required: true, maxlength: 8000 });
            const priority = select("priority", [["", "Choose…"], "High", "Medium", "Low"], { required: true });
            const software = input("software", { maxlength: 100 });
            const links = area("links", 2, { maxlength: 2000 });
            return {
                label: "Send request",
                parts: [
                    h("section", { class: "form-part" }, h("h2", null, "What are you asking for?"), h("p", null, "Choose the closest one."), choices),
                    h("section", { class: "form-part" }, h("h2", null, "Where does it belong?"), h("div", { class: "field-row" }, where.row, field("Relevant software", software, "For example Revit 2025.", true))),
                    h("section", { class: "form-part" }, h("h2", null, "Describe it"), field("Title", title, "One line that says what you want."), field("Detailed description", description, "What you have in mind, and how it is done today."), field("Problem being solved", problem, "What is slow, repetitive or error-prone."), field("Expected functionality", expected, "What it should do when it is done.")),
                    h("section", { class: "form-part" }, h("h2", null, "Finish up"), field("Priority", priority, "How soon you need it."), field("Reference links", links, "Anything that shows what you mean, one per line.", true))
                ],
                read: () => kind ? { row: { type: "request", kind, family: where.family.value, tool: clean(where.tool.value), title: title.value.trim(), description: description.value.trim(), problem: problem.value.trim(), expected: expected.value.trim(), priority: priority.value, software: clean(software.value), reference_links: clean(links.value) } } : { problem: "Choose what you are asking for." }
            };
        });
    }

    function renderReport() {
        submitForm("Report a bug", "Tell us what went wrong. A few clear steps are enough for us to find it.", "report a bug", "report/index.html", () => {
            const where = familyAndTool("Affected tool", "The list follows the family you chose.", true);
            const version = input("version", { required: true, maxlength: 30 });
            const software = input("software", { required: true, maxlength: 100 });
            const title = input("title", { required: true, minlength: 5, maxlength: 150 });
            const category = select("category", [["", "Choose…"], ...CATEGORIES], { required: true });
            const severity = select("severity", [["", "Choose…"], "Blocker", "Major", "Minor", "Cosmetic"], { required: true });
            const steps = area("steps", 4, { required: true, maxlength: 8000 });
            const expected = area("expected", 3, { required: true, maxlength: 8000 });
            const actual = area("actual", 3, { required: true, maxlength: 8000 });
            const errorText = area("error", 3, { maxlength: 8000, class: "mono" });
            return {
                label: "Report bug",
                parts: [
                    h("section", { class: "form-part" }, h("h2", null, "Where did it happen?"), h("div", { class: "field-row" }, where.row, field("Tool version", version, "For example 3.14.0."), field("Software and version", software, "For example Revit 2025 or Navisworks 2026."))),
                    h("section", { class: "form-part" }, h("h2", null, "What went wrong?"), field("Bug title", title, "One line that says what goes wrong."), h("div", { class: "field-row" }, field("Category", category, "The closest match is fine."), field("Severity", severity, "Blocker stops the work. Major has a painful workaround. Minor is a small problem. Cosmetic is only how it looks.")), field("Steps to reproduce", steps, "What to click, in order, to make it happen again."), h("div", { class: "field-row" }, field("Expected result", expected, "What should have happened."), field("Actual result", actual, "What happened instead.")), field("Error message", errorText, "Paste the full text if an error appeared. Remove any private file paths or names.", true))
                ],
                read: () => ({ row: { type: "bug", family: where.family.value, tool: where.tool.value, tool_version: version.value.trim(), software: software.value.trim(), title: title.value.trim(), category: category.value, severity: severity.value, steps: steps.value.trim(), expected: expected.value.trim(), actual: actual.value.trim(), error_message: clean(errorText.value) } })
            };
        });
    }

    // Community board
    function boardControls(onChange, withPublished) {
        const search = input("search", { type: "search", placeholder: "Title or ID" });
        const type = select("type", [["", "All"], ["request", "Requests"], ["bug", "Bugs"]]);
        const family = select("family", [["", "All"], ...FAMILIES]);
        const sort = select("sort", [["new", "Newest"], ["votes", "Most votes"]]);
        const published = withPublished ? select("published", [["no", "Waiting to publish"], ["", "All"], ["yes", "Published"]]) : null;
        [search, type, family, sort, published].forEach(el => el?.addEventListener("input", onChange));
        const box = h("div", { class: "filters" },
            h("div", { class: "field grow" }, h("label", null, h("span", { class: "field-label" }, "Search"), search)),
            h("div", { class: "field" }, h("label", null, h("span", { class: "field-label" }, "Type"), type)),
            h("div", { class: "field" }, h("label", null, h("span", { class: "field-label" }, "Product family"), family)),
            published ? h("div", { class: "field" }, h("label", null, h("span", { class: "field-label" }, "Show"), published)) : null,
            h("div", { class: "field" }, h("label", null, h("span", { class: "field-label" }, "Sort by"), sort)));
        const apply = items => {
            const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
            const shown = items.filter(i => (!type.value || i.type === type.value) && (!family.value || i.family === family.value)
                && (!published || !published.value || (published.value === "yes") === i.is_public)
                && words.every(w => (i.code + " " + i.title).toLowerCase().includes(w)));
            return sort.value === "votes" ? [...shown].sort((a, b) => b.vote_count - a.vote_count) : shown;
        };
        return { box, apply };
    }

    async function renderCommunity() {
        const actions = [link("submit/index.html", "Submit a request", "button action"), link("report/index.html", "Report a bug", "button")];
        const list = h("div", null, loading());
        const count = h("p", { class: "result-count", role: "status" });
        let items = [];
        const draw = () => {
            const shown = controls.apply(items);
            count.textContent = `${shown.length} ${shown.length === 1 ? "item" : "items"}`;
            list.replaceChildren(h("section", { class: "panel" }, itemRows(shown, empty(items.length ? "Nothing matches these filters" : "Nothing has been published yet", items.length ? "Clear a filter to see more." : "Be the first to send a request.", link("submit/index.html", "Submit a request", "button")))));
        };
        const controls = boardControls(draw);
        show(pageHead("Community", "Requests and bugs the team has published. Vote for what matters to you, and join the discussion.", ...actions), controls.box, count, list);
        const r = await sb.from("items").select(LIST_COLUMNS).eq("is_public", true).order("created_at", { ascending: false }).limit(LIST_LIMIT);
        if (r.error) return list.replaceChildren(empty("The board could not be loaded", explain(r.error)));
        items = r.data;
        draw();
    }

    // One item
    function textBlock(label, text, code) {
        if (!text) return null;
        return h("div", { class: "text-block" }, h("h3", null, label), code ? h("pre", null, text) : h("p", null, text));
    }
    function fact(label, value) {
        return value === null || value === undefined || value === "" ? null : h("div", { class: "fact" }, h("dt", null, label), h("dd", null, value));
    }

    async function renderItem() {
        const id = Number(params.get("id"));
        if (!Number.isInteger(id) || id <= 0) return show(pageHead("Item not found"), empty("There is no item at this address", null, link("community/index.html", "Go to Community", "button")));
        show(loading());
        const [itemResult, commentResult, eventResult, voteResult, blockResult] = await Promise.all([
            sb.from("items").select(`*, ${AUTHOR}`).eq("id", id).maybeSingle(),
            sb.from("comments").select("id, body, created_at, author_id, author:profiles!comments_author_id_fkey(display_name, role)").eq("item_id", id).order("id"),
            sb.from("item_events").select("id, action, new_value, at, actor:profiles!item_events_actor_id_fkey(display_name)").eq("item_id", id).order("id", { ascending: false }),
            me ? sb.from("votes").select("item_id").eq("item_id", id).eq("user_id", me.id) : Promise.resolve({ data: [] }),
            isTeam() ? sb.from("blocked_users").select("user_id") : Promise.resolve({ data: [] })
        ]);
        if (itemResult.error) return show(pageHead("Item"), empty("This item could not be loaded", explain(itemResult.error)));
        const item = itemResult.data;
        if (!item) return show(pageHead("Item not found"), empty("This item doesn't exist, or it hasn't been published", me ? null : "If you sent it, sign in to see it.", link("community/index.html", "Go to Community", "button"), me ? null : link(`account/index.html?next=${encodeURIComponent(`item/index.html?id=${id}`)}`, "Sign in", "button")));
        const voted = voteResult.data?.length > 0;
        const blocked = (blockResult.data ?? []).some(b => b.user_id === item.author_id);
        const error = message();

        const act = async fn => {
            setMessage(error);
            const r = await fn();
            if (r.error) return setMessage(error, explain(r.error));
            await renderItem();
        };

        const voteButton = item.is_public
            ? (me ? h("button", { type: "button", class: "button" + (voted ? " primary" : ""), "aria-pressed": voted ? "true" : "false", onclick: () => act(() => voted ? sb.from("votes").delete().eq("item_id", id).eq("user_id", me.id) : sb.from("votes").insert({ item_id: id })) }, `${item.type === "bug" ? "Me too" : "Upvote"} (${item.vote_count})`)
                : link(`account/index.html?next=${encodeURIComponent(`item/index.html?id=${id}`)}`, `Sign in to vote (${item.vote_count})`, "button"))
            : null;

        const comments = commentResult.data ?? [];
        const commentBox = area("comment", 3, { maxlength: 4000 });
        const commentForm = me ? h("form", { onsubmit: e => { e.preventDefault(); if (!commentBox.value.trim()) return setMessage(error, "Write something first."); act(() => sb.from("comments").insert({ item_id: id, body: commentBox.value })); } },
            field("Add a comment", commentBox, item.is_public ? "Everyone can read this. Don't include anything confidential." : "Only you and the team can read this while the item is private."),
            h("button", { type: "submit", class: "button primary" }, "Post comment"))
            : link(`account/index.html?next=${encodeURIComponent(`item/index.html?id=${id}`)}`, "Sign in to comment", "button");

        const aside = h("aside", null,
            h("section", { class: "panel" }, h("h2", null, "Summary"), h("dl", { class: "facts" },
                fact("Sent by", item.author?.display_name ?? "Former member"),
                fact("Sent on", day(item.created_at)),
                fact("Family", item.family), fact("Tool", item.tool), fact("Type", item.kind ?? "Bug"), fact("Priority", item.priority),
                fact("Severity", item.severity), fact("Category", item.category), fact("Tool version", item.tool_version), fact("Software", item.software), fact("Comments", String(item.comment_count)))),
            isTeam() ? teamPanel(item, blocked) : null);

        document.title = item.code + " | i-Tools";
        show(h("nav", { "aria-label": "Breadcrumb" }, h("ol", { class: "crumbs" }, h("li", null, link("community/index.html", "Community")), h("li", { "aria-current": "page" }, item.code))),
            h("header", { class: "page-head" }, h("div", null, h("h1", { class: "wrap-any" }, item.title))),
            h("p", { class: "card-tags live-tags" }, h("span", { class: "code" }, item.code), badge(item.type, item.status), familyMark(item.family), item.is_public ? null : h("span", { class: "tag live-private" }, "Private: only you and the team can see this"), voteButton),
            error,
            h("div", { class: "detail-grid" }, h("div", null,
                item.feedback ? h("section", { class: "panel workflow-panel" }, textBlock("Feedback from the team", item.feedback)) : null,
                h("section", { class: "panel" }, h("h2", null, "Details"),
                    textBlock("Description", item.description), textBlock("Problem being solved", item.problem), textBlock("Steps to reproduce", item.steps),
                    textBlock(item.type === "bug" ? "Expected result" : "Expected functionality", item.expected), textBlock("Actual result", item.actual),
                    textBlock("Error message", item.error_message, true), textBlock("Reference links", item.reference_links)),
                h("section", { class: "panel" }, h("h2", null, `Comments (${comments.length})`),
                    comments.length ? comments.map(c => h("article", { class: "comment" },
                        h("p", { class: "muted" }, h("strong", null, c.author?.display_name ?? "Former member"), c.author && c.author.role !== "member" ? h("span", { class: "tag live-team" }, "Team") : null, ", " + when(c.created_at),
                            (c.author_id === me?.id || isTeam()) ? h("button", { type: "button", class: "link-button", onclick: () => act(() => sb.from("comments").delete().eq("id", c.id)) }, "Delete") : null),
                        h("p", { class: "comment-body" }, c.body))) : h("p", { class: "muted" }, "No comments yet."),
                    h("div", { class: "panel-gap" }, commentForm)),
                eventResult.data?.length ? h("section", { class: "panel" }, h("h2", null, "History"), h("ol", { class: "timeline" }, eventResult.data.map(e => h("li", null, h("strong", null, e.action), e.action === "Status changed" ? ": " + statusName(item.type, e.new_value) : e.new_value ? ": " + e.new_value : "", h("div", { class: "muted" }, `${e.actor?.display_name ?? "Team"}, ${when(e.at)}`))))) : null),
                aside));
    }

    function teamPanel(item, blocked) {
        const statuses = Object.entries(statusesOf(item.type)).map(([k, v]) => [k, v[0]]);
        const status = select("status", statuses, { value: item.status });
        status.value = item.status;
        const feedback = area("feedback", 3, { maxlength: 4000, value: item.feedback ?? "" });
        const pub = h("input", { type: "checkbox", name: "public" });
        pub.checked = item.is_public;
        const error = message();
        const confirmBox = h("div", { class: "hint", role: "alert", hidden: true });
        const save = async () => {
            setMessage(error);
            const r = await sb.from("items").update({ status: status.value, feedback: clean(feedback.value), is_public: pub.checked }).eq("id", item.id);
            if (r.error) return setMessage(error, explain(r.error));
            await renderItem();
        };
        const saveClicked = () => {
            if (pub.checked && !item.is_public) {
                confirmBox.replaceChildren(h("p", null, h("strong", null, "Publish this to everyone?"), " Anyone on the internet can read all of it, with the sender's name. Check it holds nothing confidential."),
                    h("div", { class: "form-actions" }, h("button", { type: "button", class: "button danger", onclick: save }, "Yes, publish"), h("button", { type: "button", class: "button", onclick: () => { confirmBox.hidden = true; } }, "Not yet")));
                confirmBox.hidden = false;
            } else save();
        };
        const author = item.author;
        return h("section", { class: "panel workflow-panel" }, h("h2", null, "Team review"),
            field("Status", status),
            field("Feedback", feedback, "The sender reads this. If the item is public, everyone does. Required to reject."),
            h("label", { class: "task-row" }, pub, h("span", null, "Published: everyone can see this")),
            error, confirmBox,
            h("button", { type: "button", class: "button primary panel-gap", onclick: saveClicked }, "Save changes"),
            author && author.role === "member" ? h("p", { class: "panel-gap" }, h("button", { type: "button", class: "link-button", onclick: async () => {
                const r = await sb.rpc("set_blocked", { target: author.id, blocked: !blocked });
                if (r.error) return setMessage(error, explain(r.error));
                await renderItem();
            } }, blocked ? `Unblock ${author.display_name}` : `Block ${author.display_name} from posting`)) : null);
    }

    // Team queue
    async function renderTeam() {
        if (!me) return show(pageHead("Team review"), signInFirst("review", "team/index.html"));
        if (!isTeam()) return show(pageHead("Team review"), empty("This page is for the team", "Your account can't open it. Ask an admin if you think it should."));
        const list = h("div", null, loading());
        const count = h("p", { class: "result-count", role: "status" });
        let items = [];
        const draw = () => {
            const shown = controls.apply(items);
            count.textContent = `${shown.length} ${shown.length === 1 ? "item" : "items"}`;
            list.replaceChildren(h("section", { class: "panel" }, itemRows(shown, empty("Nothing here", "Nothing is waiting for this filter."))));
        };
        const controls = boardControls(draw, true);
        show(pageHead("Team review", "New items are private until you publish them. Open one to review it."), controls.box, count, list, me.role === "admin" ? peoplePanel() : null);
        const r = await sb.from("items").select(LIST_COLUMNS).order("created_at", { ascending: false }).limit(LIST_LIMIT);
        if (r.error) return list.replaceChildren(empty("The list could not be loaded", explain(r.error)));
        items = r.data;
        draw();
    }

    function peoplePanel() {
        const search = input("people", { type: "search", placeholder: "Part of a name" });
        const out = h("div", null);
        const error = message();
        const find = async () => {
            const text = search.value.trim();
            if (text.length < 2) return out.replaceChildren();
            // Escaped, because % and _ are wildcards here.
            const r = await sb.from("profiles").select("id, display_name, role").ilike("display_name", `%${text.replace(/[%_\\]/g, "\\$&")}%`).order("display_name").limit(20);
            if (r.error) return setMessage(error, explain(r.error));
            out.replaceChildren(r.data.length ? h("ul", { class: "rows" }, r.data.map(p => {
                const role = select("role", [["member", "Member"], ["team", "Team"], ["admin", "Admin"]], { "aria-label": `Role of ${p.display_name}`, disabled: p.id === me.id });
                role.value = p.role;
                role.addEventListener("input", async () => {
                    setMessage(error);
                    const u = await sb.rpc("set_role", { target: p.id, new_role: role.value });
                    if (u.error) { setMessage(error, explain(u.error)); role.value = p.role; } else p.role = role.value;
                });
                return h("li", null, h("span", { class: "rows-main wrap-any" }, p.display_name), role);
            })) : h("p", { class: "muted" }, "Nobody has that name."));
        };
        search.addEventListener("input", find);
        return h("section", { class: "panel" }, h("h2", null, "People and roles"), field("Find someone", search, "Team can review and publish. Admin can also change roles."), error, out);
    }

    // Overview panel: only appears once something is published.
    async function renderLatest() {
        const slot = document.getElementById("community-latest");
        if (!slot) return;
        const r = await sb.from("items").select(LIST_COLUMNS).eq("is_public", true).order("created_at", { ascending: false }).limit(5);
        if (r.error || !r.data.length) return;
        slot.replaceChildren(h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", null, "From the community"), link("community/index.html", "See all")),
            h("ul", { class: "rows" }, r.data.map(i => h("li", null, h("span", { class: "rows-main" }, link(`item/index.html?id=${i.id}`, i.code, "code"), " ", i.title), badge(i.type, i.status))))));
    }

    sb.auth.onAuthStateChange(event => {
        // Password reset links land here. Defer, because Supabase forbids calling it from inside this callback.
        if (event === "PASSWORD_RECOVERY") setTimeout(() => { if (view === "account") renderAccount("reset"); }, 0);
    });

    (async () => {
        await loadMe();
        const recovering = location.hash.includes("type=recovery");
        if (view === "account") renderAccount(recovering ? "reset" : "in");
        if (view === "submit") renderSubmit();
        if (view === "report") renderReport();
        if (view === "community") renderCommunity();
        if (view === "item") renderItem();
        if (view === "team") renderTeam();
        renderLatest();
    })().catch(() => { if (mount) show(empty("This page could not be loaded", "Check your connection and try again.")); });
})();
