const MODULE_ID = "vampire-bloodpool-dialog";
const BLOOD_PATHS = [
  "system.advantages.bloodpool.temporary",
  "system.advantages.bloodpool.value"
];
const DISPLAY_RENAMES = new Map([
  ["Привлекательность", "Внешность"],
  ["Совесть", "Убежденность"],
  ["Самоконтроль", "Инстинкты"]
]);
const VAMPIRE_POWER_TYPES = new Set([
  "wod.types.discipline",
  "wod.types.disciplinepower",
  "wod.types.disciplinepath",
  "wod.types.disciplinepathpower",
  "wod.types.combination",
  "wod.types.ritual"
]);
const OTHER_SPLAT_POWER_TYPES = new Set([
  "wod.types.art",
  "wod.types.artpower",
  "wod.types.arcanoi",
  "wod.types.arcanoipower",
  "wod.types.gift",
  "wod.types.rite",
  "wod.types.charm",
  "wod.types.edge",
  "wod.types.edgepower",
  "wod.types.lore",
  "wod.types.lorepower",
  "wod.types.hekau",
  "wod.types.hekaupower",
  "wod.types.numina",
  "wod.types.numinapower",
  "wod.types.horror",
  "wod.types.stain",
  "wod.types.exaltedcharm",
  "wod.types.exaltedsorcery"
]);

function elementFrom(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function bloodData(actor) {
  // The universal PC sheet stores advantages as embedded Items, unlike the
  // legacy Vampire sheet which keeps the pool under actor.system.advantages.
  if (String(actor?.type ?? "").toLowerCase() === "pc") {
    const poolItem = Array.from(actor.items ?? []).find(item =>
      String(item?.type ?? "").toLowerCase() === "advantage"
      && String(item?.system?.id ?? "").toLowerCase() === "bloodpool"
    );
    const value = Number(poolItem?.system?.temporary);
    if (poolItem && Number.isFinite(value)) {
      return {
        value,
        update: next => poolItem.update({ "system.temporary": next })
      };
    }
  }

  for (const path of BLOOD_PATHS) {
    const raw = foundry.utils.getProperty(actor, path);
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return {
        path,
        value,
        update: next => actor.update({ [path]: next })
      };
    }
  }
  return null;
}

function hasVampireDisciplines(actor) {
  return actor?.system?.settings?.hasdisciplines === true
    || actor?.system?.settings?.powers?.hasdisciplines === true
    || Array.from(actor?.items ?? []).some(item =>
      ["wod.types.discipline", "wod.types.disciplinepower", "wod.types.combination"]
        .includes(String(item?.system?.type ?? "").toLowerCase())
    );
}

function isVampireActor(actor) {
  if (!actor) return false;
  const actorType = String(actor.type ?? "").toLowerCase();
  if (actorType === "vampire") return true;
  if (actorType !== "pc") return false;

  // The base PC sheet derives this flag separately from its nested power
  // settings. Keep both paths for different WoD20 versions.
  return hasVampireDisciplines(actor) || Array.from(actor.items ?? []).some(item =>
    VAMPIRE_POWER_TYPES.has(String(item?.system?.type ?? "").toLowerCase())
  );
}

function validVampireActor(candidate) {
  // Resolve Vampire PCs even when their Blood Pool advantage has not yet
  // been added. Without this, the roll dialog cannot show the setup warning.
  return candidate?.documentName === "Actor" && isVampireActor(candidate);
}

function isVampirePowerDialog(app, root = null) {
  const sheetTypes = [
    app?.object?.sheettype,
    app?.item?.sheettype,
    app?.document?.sheettype,
    app?.options?.sheettype
  ].map(value => String(value ?? "").toLowerCase());
  if (sheetTypes.includes("vampiredialog")) return true;

  return Boolean(
    root?.matches?.(".vampireDialog, .vampiredialog")
    || root?.querySelector?.("form.vampireDialog, form.vampiredialog")
    || root?.closest?.(".vampireDialog, .vampiredialog")
  );
}

function isPowerRollDialog(app, root = null) {
  const sheetTypes = [
    app?.object?.sheettype,
    app?.item?.sheettype,
    app?.document?.sheettype,
    app?.options?.sheettype
  ].map(value => String(value ?? "").toLowerCase());
  if (sheetTypes.some(type => ["vampiredialog", "creaturedialog"].includes(type))) return true;

  return Boolean(
    root?.matches?.(".power-dialog")
    || root?.querySelector?.("form.power-dialog")
    || root?.closest?.(".power-dialog")
  );
}

function actorFrom(app, root = null) {
  // Different WoD20/Foundry combinations expose the owner of a rolled Item in
  // different places. Follow the known parent/actor/document links instead of
  // relying only on app.actor.
  const seeds = [
    game.actors?.get?.(root?.dataset?.vampireBloodActorId),
    game.actors?.get?.(root?.closest?.(".window-app, .application")?.dataset?.vampireBloodActorId),
    app?.actor,
    app?.item,
    app?.document,
    app?.object,
    app?.options?.actor,
    app?.options?.item,
    app?.options?.document,
    app?.data?.actor,
    app?.data?.item,
    canvas?.tokens?.controlled?.[0],
    game.user?.character
  ];
  const queue = seeds.filter(Boolean);
  const visited = new Set();
  const vampirePowerDialog = isVampirePowerDialog(app, root);

  while (queue.length) {
    const candidate = queue.shift();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);
    if (validVampireActor(candidate)) return candidate;

    // WoD20's DialogPower uses this explicit sheet type for Discipline rolls.
    // A transferred Discipline on a universal PC can lack the Vampire flags
    // used by isVampireActor(), even though this dialog is unambiguously a
    // Vampire power roll. Trust its direct actor reference when it has blood.
    const actorType = String(candidate?.type ?? "").toLowerCase();
    if (vampirePowerDialog
      && candidate?.documentName === "Actor"
      && ["pc", "vampire"].includes(actorType)
      && bloodData(candidate)) return candidate;

    for (const linked of [
      candidate.actor,
      candidate.parent,
      candidate.document,
      candidate.object,
      candidate.item,
      candidate.token?.actor
    ]) {
      if (linked && !visited.has(linked)) queue.push(linked);
    }
  }

  // Some legacy WoD20 roll dialogs contain no document reference at all, but
  // their window title is the Actor name (as in the player's screenshot).
  const windowRoot = root?.closest?.(".window-app, .application") ?? root;
  const visibleTitles = [
    app?.title,
    windowRoot?.querySelector?.(".window-title")?.textContent,
    windowRoot?.querySelector?.("header h4, header h3")?.textContent
  ].filter(value => typeof value === "string" && value.trim());
  const vampires = game.actors?.filter?.(validVampireActor) ?? [];
  for (const title of visibleTitles) {
    const normalized = title.trim().toLocaleLowerCase("ru-RU");
    const named = vampires.find(actor => {
      const name = String(actor.name ?? "").trim().toLocaleLowerCase("ru-RU");
      return name && (normalized === name || normalized.startsWith(`${name} `));
    });
    if (named) return named;
  }

  // Player accounts commonly own one Vampire without assigning it as their
  // Foundry character. That is an unambiguous and safe final fallback.
  if (!game.user?.isGM) {
    const owned = vampires.filter(actor => actor.isOwner);
    if (owned.length === 1) return owned[0];
  }
  return null;
}

const RUSSIAN_NUMBERS = new Map([
  ["ноль", 0], ["один", 1], ["одна", 1], ["одно", 1],
  ["два", 2], ["две", 2], ["три", 3], ["четыре", 4],
  ["пять", 5], ["шесть", 6], ["семь", 7], ["восемь", 8],
  ["девять", 9], ["десять", 10]
]);

function parsedNumber(value) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("ru-RU");
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
  return RUSSIAN_NUMBERS.get(normalized) ?? null;
}

function bloodCostFromText(text) {
  const source = String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru-RU");
  const number = "(\\d+|ноль|один|одна|одно|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)";
  const unit = "(?:пункт(?:а|ов)?|очк(?:о|а|ов))";
  const patterns = [
    new RegExp(`(?:цена|стоимость|стоит|обходится|требует|затрат(?:а|ить|ив)|потрат(?:ить|ив|ьте)|расход(?:уется|овать))\\s*(?:в|составляет|равна?)?\\s*[:—-]?\\s*${number}\\s+${unit}\\s+крови`, "iu"),
    new RegExp(`${number}\\s+${unit}\\s+крови[^.!?;]{0,35}?(?:цена|стоимость|стоит|затрат|потрат|расход)`, "iu")
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const value = parsedNumber(match?.[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }

  // Phrases without an explicit numeral always mean one point.
  if (/(?:потратив|потратить|затратив|затратить|расходуется|цена|стоимость|стоит)[^.!?;:]{0,45}?(?:пункт|очко)\s+крови/iu.test(source)) return 1;
  return 1;
}

function disciplineText(app, root) {
  const candidates = [
    app?.object?.system?.description,
    app?.object?.system?.system,
    app?.item?.system?.description,
    app?.item?.system?.system,
    app?.document?.system?.description,
    app?.document?.system?.system,
    root?.textContent
  ];
  return candidates.filter(value => typeof value === "string").join(" ");
}

function renamedText(value) {
  if (typeof value !== "string") return value;
  let result = value;
  for (const [source, replacement] of DISPLAY_RENAMES) {
    result = result.split(source).join(replacement);
  }
  return result;
}

function correctVampireLabels(app, root, suppliedActor = null) {
  const actor = suppliedActor ?? actorFrom(app, root);
  const rootText = root.textContent ?? "";
  const isRoll = /Пул\s+костей/i.test(rootText) && /(?:Бросок|Закрыть|Roll|Close)/i.test(rootText);
  const isVampire = Boolean(actor)
    || /Вампир(?:ы)?:\s*Маскарад(?:а)?|Vampire(?:s)?:\s*The Masquerade/i.test(rootText)
    || (isRoll && Boolean(actor));
  if (!isVampire) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, textarea, [contenteditable='true']")) continue;
    node.textContent = renamedText(node.textContent);
  }

  for (const element of root.querySelectorAll("[placeholder], [title], [aria-label], [data-tooltip]")) {
    for (const attribute of ["placeholder", "title", "aria-label", "data-tooltip"]) {
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute);
      const corrected = renamedText(current);
      if (corrected !== current) element.setAttribute(attribute, corrected);
    }
  }
}

function numericDamage(actor) {
  const damage = actor?.system?.health?.damage ?? {};
  return ["bashing", "lethal", "aggravated"].reduce((total, type) => {
    const value = Number(damage[type]);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function legacyHealthLabel(actor) {
  let remaining = numericDamage(actor);
  if (remaining <= 0) return game.i18n.localize("wod.health.uninjured");

  for (const level of ["bruised", "hurt", "injured", "wounded", "mauled", "crippled"]) {
    const data = actor?.system?.health?.[level];
    const boxes = Number(data?.total);
    if (!Number.isFinite(boxes) || boxes <= 0) continue;
    remaining -= boxes;
    if (remaining <= 0) return game.i18n.localize(data?.label ?? `wod.health.${level}`);
  }
  return game.i18n.localize("wod.health.incapacitated");
}

function correctLegacyVampireHealth(root, actor) {
  const actorType = String(actor?.type ?? "").toLowerCase();
  const supportedActor = actorType === "vampire"
    || (actorType === "pc" && isVampireActor(actor));
  if (!supportedActor) return;
  const headings = [...root.querySelectorAll(".sheet-headline, h1, h2, h3, h4")].filter(element => {
    const text = String(element.textContent ?? "").replace(/\s+/g, " ").trim();
    return /^(здоровье|health)$/i.test(text);
  });

  // Vampire and PC sheets may render the same health partial independently on
  // Main and Combat. Correct every copy, including a currently hidden tab.
  for (const heading of headings) {
    const container = heading.nextElementSibling;
    const label = container?.querySelector?.(":scope > div") ?? container?.firstElementChild;
    if (!label) continue;
    label.textContent = legacyHealthLabel(actor);
    label.dataset.vampireHealthCorrected = "true";
  }
}

function ensureVampireEffectPlus(root, actor) {
  if (String(actor?.type ?? "").toLowerCase() !== "vampire" || !actor.isOwner) return;

  const effectTab = root.querySelector('.tab[data-tab="effect"], .sheet-inner-area[data-tab="effect"]');
  if (!effectTab) return;

  // The Effects tab itself in the legacy Vampire sheet collapses to the height
  // of its table header when it has no rows.  Anchoring the + to that element
  // therefore puts the button in the top-right corner.  Instead, anchor the
  // button to the full sheet content (same visual area used by the PC sheet)
  // and only show it while the Effects tab is actually visible.
  const windowRoot = root.closest?.(".window-app, .application") ?? root;
  const host = windowRoot.querySelector?.(":scope > .window-content")
    ?? windowRoot.querySelector?.(".window-content")
    ?? root;
  host.classList.add("vampire-effect-plus-host");

  let plus = windowRoot.querySelector?.('.vampire-effect-plus');
  if (plus && plus.parentElement !== host) plus.remove();
  plus = host.querySelector?.(':scope > .vampire-effect-plus');

  if (!plus) {
    plus = document.createElement("button");
    plus.type = "button";
    plus.className = "vampire-effect-plus";
    plus.dataset.origin = "effect";
    plus.title = game.i18n.localize("wod.labels.add.item");
    plus.setAttribute("aria-label", game.i18n.localize("wod.labels.add.item"));
    plus.innerHTML = '<span aria-hidden="true">+</span>';

    const createEffect = async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        const created = await actor.createEmbeddedDocuments("Item", [{
          name: game.i18n.localize("wod.labels.new.bonus"),
          type: "Bonus",
          system: {
            label: game.i18n.localize("wod.labels.new.bonus"),
            isvisible: true,
            isremovable: true,
            settings: { isvisible: true, isremovable: true }
          }
        }]);
        const bonus = created?.[0];
        if (bonus?.sheet?.render) bonus.sheet.render(true);
      } catch (error) {
        console.error(`${MODULE_ID} | Effect creation failed`, error);
        ui.notifications.error("Не удалось создать эффект.");
      }
    };

    plus.addEventListener("click", createEffect, true);
    plus.addEventListener("pointerdown", event => event.stopImmediatePropagation(), true);
    host.append(plus);
  }

  const syncVisibility = () => {
    if (!plus.isConnected || !effectTab.isConnected) return;
    const style = getComputedStyle(effectTab);
    const visible = !effectTab.hidden
      && effectTab.getAttribute("aria-hidden") !== "true"
      && style.display !== "none"
      && style.visibility !== "hidden"
      && effectTab.getClientRects().length > 0;
    plus.hidden = !visible;
  };

  // Rebind when a sheet re-render replaces the tab element but leaves the
  // window shell alive.
  if (plus._vampireEffectTab !== effectTab) {
    plus._vampireEffectObserver?.disconnect?.();
    const observer = new MutationObserver(syncVisibility);
    observer.observe(effectTab, {
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"]
    });
    if (effectTab.parentElement) {
      observer.observe(effectTab.parentElement, {
        attributes: true,
        childList: true,
        subtree: false
      });
    }
    plus._vampireEffectObserver = observer;
    plus._vampireEffectTab = effectTab;
  }

  // WoD20 changes tabs on click and then mutates classes/display.  The observer
  // handles that; these two frames also cover versions that toggle visibility
  // without touching an observed attribute on the tab itself.
  syncVisibility();
  requestAnimationFrame(syncVisibility);
  setTimeout(syncVisibility, 0);
}

function willpowerCheckbox(root) {
  const direct = root.querySelector(
    'input[type="checkbox"][name*="willpower" i], input[type="checkbox"][id*="willpower" i], input[type="checkbox"][class*="willpower" i]'
  );
  if (direct) return direct;

  return [...root.querySelectorAll('input[type="checkbox"]')].find(input => {
    const container = input.closest("label, .form-group, .flexrow, div") ?? input.parentElement;
    return /сил[ау]\s+воли|willpower/i.test(container?.textContent ?? "");
  });
}

function hasSectionHeading(root, pattern) {
  return [...root.querySelectorAll("*")].some(element => {
    const ownText = [...element.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join(" ")
      .trim();
    return pattern.test(ownText);
  });
}

function isVampirePowerRoll(app, root, actor) {
  const objectTypes = [
    app?.object?.type,
    app?.object?.system?.type,
    app?.item?.type,
    app?.item?.system?.type,
    app?.document?.type,
    app?.document?.system?.type
  ].map(type => String(type ?? "").toLowerCase());
  if (objectTypes.some(type => VAMPIRE_POWER_TYPES.has(type))) return true;
  if (objectTypes.some(type => OTHER_SPLAT_POWER_TYPES.has(type))) return false;

  const itemId = app?.object?._id ?? app?.object?.id ?? app?.item?._id ?? app?.item?.id ?? app?.document?._id ?? app?.document?.id;
  const embeddedItem = itemId ? actor?.items?.get?.(itemId) : null;
  const embeddedType = String(embeddedItem?.system?.type ?? "").toLowerCase();
  if (VAMPIRE_POWER_TYPES.has(embeddedType)) return true;
  if (OTHER_SPLAT_POWER_TYPES.has(embeddedType)) return false;

  if (isVampirePowerDialog(app, root)) return true;

  // Some PC sheets turn a transferred Vampire Discipline into a generic
  // WoD20 Power item. Such an item opens creatureDialog instead of
  // vampireDialog, so the earlier exact-type checks miss it. The Blood Pool
  // and PC Discipline markers together identify this as a Vampire character;
  // limiting the fallback to power dialogs keeps ordinary PC rolls untouched.
  const isVampirePC = String(actor?.type ?? "").toLowerCase() === "pc"
    && hasVampireDisciplines(actor);
  const hasGenericPowerType = objectTypes.includes("wod.types.power")
    || String(embeddedItem?.type ?? "").toLowerCase() === "power";
  return isVampirePC
    && isPowerRollDialog(app, root)
    && (hasGenericPowerType || !objectTypes.some(Boolean));
}

function isDisciplineRoll(app, root, actor) {
  if (!actor) return false;
  const hasDescription = hasSectionHeading(root, /^(описание|description)$/i);
  const hasSystem = hasSectionHeading(root, /^(система|system)$/i);
  if (!hasDescription || !hasSystem) return false;

  // Legacy Vampire actors used this same full dialog before all metadata was
  // consistently exposed. Preserve their established behavior. Universal PC
  // actors must additionally carry a Vampire-power marker, preventing Blood
  // controls from appearing in Arcanoi and other enabled power families.
  if (String(actor.type ?? "").toLowerCase() === "vampire") return true;
  return isVampirePowerRoll(app, root, actor);
}

function rollButton(root) {
  const direct = root.querySelector(
    '[data-button="roll"], [data-action="roll"], button.roll, button[name="roll"]'
  );
  if (direct) return direct;

  return [...root.querySelectorAll("button")].find(button =>
    /^\s*(бросок|бросить|roll)\s*$/i.test(button.textContent ?? "")
  );
}

function difficultyContainer(root) {
  const heading = [...root.querySelectorAll("*")].find(element => {
    const ownText = [...element.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join(" ")
      .trim();
    return /^сложность$|^difficulty$/i.test(ownText);
  });

  let panel = heading?.parentElement;
  while (panel && panel !== root) {
    const numbered = [...panel.querySelectorAll("button, a, label, span, div")].filter(element =>
      /^(2|3|4|5|6|7|8|9|10)$/.test(element.textContent?.trim() ?? "")
    );
    if (numbered.length >= 5) return panel;
    panel = panel.parentElement;
  }
  return null;
}

function selectedDifficulty(root) {
  const selected = root.querySelector([
    ".dialog-difficulty-button.active",
    ".dialog-difficulty-button[aria-pressed='true']",
    "[data-difficulty].active",
    "input[name*='difficulty' i]:checked",
    "select[name*='difficulty' i]"
  ].join(", "));
  if (!selected) return null;

  const value = Number.parseInt(
    selected.value
      ?? selected.dataset?.difficulty
      ?? selected.dataset?.index
      ?? selected.textContent,
    10
  );
  return Number.isInteger(value) && value >= 2 && value <= 10 ? value : null;
}

function insertControls(root, willpower, current, defaultCost = 1) {
  const hasResource = Number.isFinite(current);
  const row = document.createElement("div");
  row.className = "vampire-blood-spend";
  row.innerHTML = `
    <div class="vampire-blood-check" data-blood-use role="checkbox" aria-checked="true" tabindex="0">
      <span class="vampire-blood-box" aria-hidden="true"></span>
      <span>Использовать Запас крови</span>
    </div>
    <label class="vampire-blood-cost">
      <span>Стоимость</span>
      <input type="number" data-blood-cost value="${defaultCost}" min="1" max="${Math.max(1, current ?? 0, defaultCost)}" step="1">
    </label>
    <span class="vampire-blood-current${hasResource ? "" : " is-missing"}" title="Текущий Запас крови">${hasResource ? `Доступно: ${current}` : "Запас крови не настроен"}</span>
  `;

  const difficulty = difficultyContainer(root);
  if (difficulty) {
    difficulty.insertAdjacentElement("beforebegin", row);
    const syncWidth = () => {
      if (!difficulty.isConnected || !row.isConnected) return;
      row.style.width = `${difficulty.getBoundingClientRect().width}px`;
    };
    syncWidth();
    if (globalThis.ResizeObserver) {
      const observer = new ResizeObserver(syncWidth);
      observer.observe(difficulty);
    }
  } else {
    const anchor = willpower.closest("label, .form-group") ?? willpower.parentElement;
    anchor?.insertAdjacentElement("afterend", row);
  }
  root.dataset.vampireBloodReady = "true";

  const toggle = row.querySelector("[data-blood-use]");
  const cost = row.querySelector("[data-blood-cost]");
  toggle.checked = true;

  const setChecked = checked => {
    toggle.checked = Boolean(checked);
    toggle.setAttribute("aria-checked", String(toggle.checked));
    row.classList.toggle("is-active", toggle.checked);
  };
  setChecked(true);

  toggle.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    setChecked(!toggle.checked);
  }, true);
  toggle.addEventListener("keydown", event => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setChecked(!toggle.checked);
  }, true);

  for (const eventName of ["pointerdown", "mousedown", "click", "keydown", "keyup", "input", "change"]) {
    cost.addEventListener(eventName, event => event.stopImmediatePropagation(), true);
  }

  return { row, toggle, cost };
}

function enhance(app, html) {
  const root = elementFrom(html) ?? app?.element?.[0] ?? app?.element;
  if (!(root instanceof HTMLElement)) return;

  const actor = actorFrom(app, root);
  if (actor) {
    root.dataset.vampireBloodActorId = actor.id;
    const windowRoot = root.closest?.(".window-app, .application");
    if (windowRoot) windowRoot.dataset.vampireBloodActorId = actor.id;
    correctVampireLabels(app, root, actor);
    correctLegacyVampireHealth(root, actor);
    ensureVampireEffectPlus(root, actor);
  } else {
    correctVampireLabels(app, root);
  }
  if (root.dataset.vampireBloodReady === "true") return;

  if (!isDisciplineRoll(app, root, actor)) return;

  const willpower = willpowerCheckbox(root);
  const button = rollButton(root);
  const resource = actor && bloodData(actor);
  if (!willpower || !button) return;

  const defaultCost = bloodCostFromText(disciplineText(app, root));
  const { row, toggle, cost } = insertControls(root, willpower, resource?.value ?? null, defaultCost);

  requestAnimationFrame(() => {
    try {
      if (typeof app?.setPosition === "function") app.setPosition({ height: "auto" });
    } catch (error) {
      console.debug(`${MODULE_ID} | Dialog resize skipped`, error);
    }
  });

  button.addEventListener("click", async event => {
    if (button.dataset.bloodApproved === "true" || !toggle.checked) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!bloodData(actor)) {
      return ui.notifications.error(
        "У этого PC не настроен Запас крови. Добавьте преимущество Blood Pool / Запас крови в карточку; кровь не списана и бросок не выполнен."
      );
    }

    // WoD20 represents "Dont Show" as difficulty -1 and aborts in its own
    // handler. Validate first so an aborted roll can never consume Blood.
    if (selectedDifficulty(root) === null) {
      const message = game.i18n.localize("wod.dialog.missingdifficulty");
      return ui.notifications.warn(
        message && message !== "wod.dialog.missingdifficulty"
          ? message
          : "Выберите сложность броска. Кровь не потрачена."
      );
    }

    const live = bloodData(actor);
    const amount = Number.parseInt(cost.value, 10);

    if (!Number.isInteger(amount) || amount < 1) {
      return ui.notifications.warn("Укажите стоимость Дисциплины в крови: целое число от 1.");
    }
    if (!live || live.value < amount) {
      return ui.notifications.error(`Недостаточно крови: требуется ${amount}, доступно ${live?.value ?? 0}.`);
    }

    button.disabled = true;
    try {
      await live.update(live.value - amount);
      row.querySelector(".vampire-blood-current").textContent = `Доступно: ${live.value - amount}`;
      ui.notifications.info(`Запас крови: −${amount} (${live.value - amount} осталось)`);

      button.dataset.bloodApproved = "true";
      button.disabled = false;
      button.click();
    } catch (error) {
      button.disabled = false;
      console.error(`${MODULE_ID} | Blood Pool update failed`, error);
      ui.notifications.error("Не удалось списать кровь. Бросок отменён.");
    } finally {
      delete button.dataset.bloodApproved;
    }
  }, true);
}

Hooks.once("init", () => console.log(`${MODULE_ID} | Initialized`));

Hooks.once("ready", () => {
  let queued = false;
  const correctOpenSheets = () => {
    queued = false;
    for (const root of document.querySelectorAll(".window-app, .application")) {
      const actor = actorFrom(null, root);
      const isVampireWindow = Boolean(actor)
        || /Вампир(?:ы)?:\s*Маскарад(?:а)?|Vampire(?:s)?:\s*The Masquerade/i.test(root.textContent ?? "");
      if (!isVampireWindow) continue;
      if (actor) root.dataset.vampireBloodActorId = actor.id;
      correctVampireLabels(null, root, actor);
      correctLegacyVampireHealth(root, actor);
      ensureVampireEffectPlus(root, actor);
    }
  };
  const scheduleCorrection = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(correctOpenSheets);
  };

  new MutationObserver(scheduleCorrection).observe(document.body, {
    childList: true,
    subtree: true
  });
  scheduleCorrection();
});

for (const hook of ["renderApplication", "renderDialog", "renderApplicationV2", "renderDialogV2"]) {
  Hooks.on(hook, enhance);
}
