// Theme, sidebar, Ctrl K search and page filters for the public site. No server and no tracking.
(function () {
    const root = document.documentElement;
    const base = root.dataset.root;
    const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* blocked storage only loses the preference */ } };

    function apply() {
        root.dataset.theme = read("hub-theme") === "light" ? "light" : "dark";
        root.dataset.sidebar = read("hub-sidebar") === "rail" ? "rail" : "full";
    }

    document.addEventListener("click", e => {
        const action = e.target.closest("[data-hub]")?.dataset.hub;
        if (action === "theme") { write("hub-theme", root.dataset.theme === "light" ? "dark" : "light"); apply(); }
        if (action === "rail") { write("hub-sidebar", root.dataset.sidebar === "rail" ? "full" : "rail"); apply(); }
        if (action === "menu") root.dataset.menu = root.dataset.menu === "open" ? "" : "open";
        if (action === "close-menu") root.dataset.menu = "";
        if (action === "palette") openPalette();
        if (e.target === dialog) dialog.close();
    });

    // Palette
    const dialog = document.getElementById("palette");
    const input = document.getElementById("palette-input");
    const list = document.getElementById("palette-list");
    let hits = [], active = 0;

    function find(text) {
        const words = text.toLowerCase().split(/\s+/).filter(Boolean);
        const has = (hay) => words.every(w => hay.includes(w));
        if (!words.length) return HUB_INDEX.filter(h => h.group === "Go to");
        const named = HUB_INDEX.filter(h => has(h.title.toLowerCase()));
        const described = HUB_INDEX.filter(h => !named.includes(h) && h.text && has(h.text));
        return [...named, ...described].slice(0, 14);
    }

    function openPalette() {
        if (dialog.open) return;
        dialog.showModal();
        input.value = "";
        draw("");
    }

    function draw(text) {
        hits = find(text);
        active = 0;
        list.replaceChildren();
        if (!hits.length) {
            const li = document.createElement("li");
            li.className = "palette-empty";
            li.textContent = `Nothing found for "${text}". Try fewer words.`;
            list.append(li);
            return;
        }
        let group = null;
        hits.forEach((hit, index) => {
            if (hit.group !== group) {
                group = hit.group;
                const head = document.createElement("li");
                head.className = "palette-group";
                head.setAttribute("role", "presentation");
                head.textContent = group;
                list.append(head);
            }
            const li = document.createElement("li");
            li.setAttribute("role", "presentation");
            const link = document.createElement("a");
            link.className = "palette-hit";
            link.id = "palette-hit-" + index;
            link.href = base + hit.href;
            link.tabIndex = -1;
            link.setAttribute("role", "option");
            const title = document.createElement("span");
            title.textContent = hit.title;
            const detail = document.createElement("span");
            detail.textContent = hit.detail ?? "";
            link.append(title, detail);
            link.addEventListener("mousemove", () => { active = index; mark(); });
            li.append(link);
            list.append(li);
        });
        mark();
    }

    function mark() {
        document.querySelectorAll(".palette-hit").forEach((el, index) => {
            el.setAttribute("aria-selected", index === active ? "true" : "false");
            if (index === active) { el.scrollIntoView({ block: "nearest" }); input.setAttribute("aria-activedescendant", el.id); }
        });
    }

    input.addEventListener("input", () => draw(input.value));
    document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
        if (e.target !== input) return;
        if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); active = (active + 1) % hits.length; mark(); }
        if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); active = (active - 1 + hits.length) % hits.length; mark(); }
        if (e.key === "Enter" && hits[active]) { e.preventDefault(); location.href = base + hits[active].href; }
    });

    // Tools library filters
    const search = document.getElementById("tool-search");
    if (search) {
        const family = document.getElementById("tool-family");
        const group = document.getElementById("tool-group");
        const cards = [...document.querySelectorAll("#tool-groups .tool-card")];
        const sections = [...document.querySelectorAll("#tool-groups .tool-section")].reverse();
        const filter = () => {
            const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
            let shown = 0;
            for (const card of cards) {
                const ok = (!family.value || card.dataset.family === family.value)
                    && (!group.value || card.dataset.group === group.value)
                    && words.every(w => card.dataset.text.includes(w));
                card.hidden = !ok;
                if (ok) shown++;
            }
            // Inner groups first, thanks to the reverse above, so a family hides once its groups are empty.
            for (const section of sections) section.hidden = ![...section.querySelectorAll(".tool-card")].some(c => !c.hidden);
            document.getElementById("tool-count").textContent = `${shown} ${shown === 1 ? "tool" : "tools"}`;
            document.getElementById("tool-empty").hidden = shown > 0;
        };
        [search, family, group].forEach(el => el.addEventListener("input", filter));
        document.getElementById("tool-clear").addEventListener("click", () => { search.value = ""; family.value = ""; group.value = ""; filter(); });
    }

    // Releases filter
    const releaseFamily = document.getElementById("release-family");
    if (releaseFamily) {
        releaseFamily.addEventListener("input", () => {
            document.querySelectorAll(".release").forEach(r => { r.hidden = releaseFamily.value !== "" && r.dataset.family !== releaseFamily.value; });
        });
    }
})();
