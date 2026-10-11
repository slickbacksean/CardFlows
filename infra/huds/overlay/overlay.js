(function () {
  const nameEl = document.getElementById("name");
  const bandEl = document.getElementById("band");
  const thumbEl = document.getElementById("thumb");
  const rawEl = document.getElementById("raw");
  const psa9El = document.getElementById("psa9");
  const psa10El = document.getElementById("psa10");
  if (!nameEl || !bandEl || typeof HUDS === "undefined") return;

  let scannerOn = false;
  let tcgdexId = null;
  let guess = null;

  function dollar(amount) {
    if (!amount) return "";
    return String(amount).charAt(0) === "$" ? amount : "$" + amount;
  }

  function render() {
    if (rawEl) rawEl.textContent = "";
    if (psa9El) psa9El.textContent = "";
    if (psa10El) psa10El.textContent = "";
    if (tcgdexId) {
      const name = (guess && guess.name) || tcgdexId;
      bandEl.setAttribute("data-kind", "live_guess");
      bandEl.setAttribute("aria-label", name + " live guess, not confirmed");
      nameEl.textContent = name;
      if (rawEl) rawEl.textContent = dollar((guess && (guess.rawAmount || guess.estimateAmount)) || "");
      if (psa9El) psa9El.textContent = dollar((guess && guess.psa9Amount) || "");
      if (psa10El) psa10El.textContent = dollar((guess && guess.psa10Amount) || "");
      if (thumbEl) {
        if (guess && guess.imageUrl) {
          thumbEl.style.backgroundImage = "url(" + guess.imageUrl + ")";
          thumbEl.setAttribute("aria-label", name + " catalog art");
        } else {
          thumbEl.style.backgroundImage = "";
          thumbEl.setAttribute("aria-label", name + " live guess");
        }
      }
      return;
    }
    if (thumbEl) {
      thumbEl.style.backgroundImage = "";
      thumbEl.setAttribute("aria-label", "No catalog art");
    }
    if (scannerOn) {
      bandEl.setAttribute("data-kind", "looking");
      bandEl.setAttribute("aria-label", "CardFlow overlay, looking for a card");
      nameEl.textContent = "Looking for a card…";
      return;
    }
    bandEl.setAttribute("data-kind", "scanner_off");
    bandEl.setAttribute("aria-label", "CardFlow overlay, no card confirmed");
    nameEl.textContent = "Scanner off";
  }

  const huds = new HUDS();
  huds.connect();
  huds.bind("scanner", function (_event, data) {
    scannerOn = Boolean(data && data.on);
    if (!scannerOn) {
      tcgdexId = null;
      guess = null;
    }
    render();
  });
  huds.bind("identity", function (_event, data) {
    const next = data && typeof data.tcgdexId === "string" ? data.tcgdexId : null;
    tcgdexId = next;
    guess = next ? data : null;
    render();
  });
  render();
})();
