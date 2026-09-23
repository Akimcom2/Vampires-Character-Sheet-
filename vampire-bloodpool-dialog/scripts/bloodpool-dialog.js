const MODULE_ID = "vampire-bloodpool-dialog";
const BLOOD_PATHS = [
  "system.advantages.bloodpool.temporary",
  "system.advantages.bloodpool.value"
];
const DISPLAY_RENAMES = new Map([
  ["Привлекательность", "Внешность"]
]);

function elementFrom(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function bloodData(actor) {
  for (const path of BLOOD_PATHS) {
    const raw = foundry.utils.getProperty(actor, path);
    const value = Number(raw);
    if (Number.isFinite(value)) return { path, value };
  }
  return null;
}

function isVampireActor(actor) {
  if (!actor) return false;
  return String(actor.type ?? "").toLowerCase() === "vampire";
}

function actorFrom(app) {
  const candidates = [
    app?.actor,
    app?.item?.actor,
    app?.document?.actor,
    app?.object?.actor,
    app?.options?.actor,
    app?.options?.item?.actor,
    canvas?.tokens?.controlled?.[0]?.actor,
    game.user?.character
  ];

  return candidates.find(candidate =>
    candidate?.documentName === "Actor" && isVampireActor(candidate) && bloodData(candidate)
  );
}

function renamedText(value) {
  if (typeof value !== "string") return value;
  let result = value;
  for (const [source, replacement] of DISPLAY_RENAMES) {
    result = result.split(source).join(replacement);
  }
  return result;
}

function correctVampireLabels(app, root) {
  const actor = actorFrom(app);
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

function isDisciplineRoll(root, actor) {
  if (!actor || !bloodData(actor)) return false;
  const hasDescription = hasSectionHeading(root, /^(описание|description)$/i);
  const hasSystem = hasSectionHeading(root, /^(система|system)$/i);
  return hasDescription && hasSystem;
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

function insertControls(root, willpower, current) {
  const row = document.createElement("div");
  row.className = "vampire-blood-spend";
  row.innerHTML = `
    <div class="vampire-blood-check" data-blood-use role="checkbox" aria-checked="false" tabindex="0">
      <span class="vampire-blood-box" aria-hidden="true"></span>
      <span>Использовать Запас крови</span>
    </div>
    <label class="vampire-blood-cost">
      <span>Стоимость</span>
      <input type="number" data-blood-cost value="1" min="1" max="${Math.max(1, current)}" step="1">
    </label>
    <span class="vampire-blood-current" title="Текущий Запас крови">Доступно: ${current}</span>
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
  toggle.checked = false;

  const setChecked = checked => {
    toggle.checked = Boolean(checked);
    toggle.setAttribute("aria-checked", String(toggle.checked));
    row.classList.toggle("is-active", toggle.checked);
  };

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

  correctVampireLabels(app, root);
  if (root.dataset.vampireBloodReady === "true") return;

  const actor = actorFrom(app);
  if (!isDisciplineRoll(root, actor)) return;

  const willpower = willpowerCheckbox(root);
  const button = rollButton(root);
  const resource = actor && bloodData(actor);
  if (!willpower || !button || !resource) return;

  const { row, toggle, cost } = insertControls(root, willpower, resource.value);

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
      await actor.update({ [live.path]: live.value - amount });
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
      if (/Вампир(?:ы)?:\s*Маскарад(?:а)?|Vampire(?:s)?:\s*The Masquerade/i.test(root.textContent ?? "")) {
        correctVampireLabels(null, root);
      }
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
