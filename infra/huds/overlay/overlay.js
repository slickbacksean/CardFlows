(function () {
  const nameEl = document.getElementById("name");
  const bodyEl = document.getElementById("body");
  const bandEl = document.getElementById("band");
  const thumbEl = document.getElementById("thumb");
  const figuresEl = document.getElementById("figures");
  const estimateEl = document.getElementById("estimate");
  const maxbuyEl = document.getElementById("maxbuy");
  const gradeEl = document.getElementById("grade");
  if (!nameEl || !bodyEl || !bandEl || typeof HUDS === "undefined") return;

  let scannerOn = false;
  let tcgdexId = null;
  let guess = null;

  function dollar(amount) {
    if (!amount) return null;
    return String(amount).charAt(0) === "$" ? amount : "$" + amount;
  }

  function render() {
    if (tcgdexId) {
      const name = (guess && guess.name) || tcgdexId;
      const setLine =
        guess && guess.setName
          ? guess.setName + (guess.number ? " · " + guess.number : "")
          : "";
      const estimateValue = dollar(guess && guess.estimateAmount) || "No estimate";
      const maxBuyValue = dollar(guess && guess.maxBuyAmount) || "—";
      bandEl.setAttribute(
        "aria-label",
        name + " live guess, Estimate " + estimateValue + ", Max Buy " + maxBuyValue + ", Grade —, not confirmed",
      );
      nameEl.textContent = name;
      bodyEl.textContent = setLine
        ? setLine + " · Live guess · not confirmed"
        : "Live guess · not confirmed";
      if (figuresEl) figuresEl.hidden = false;
      if (estimateEl) estimateEl.textContent = estimateValue;
      if (maxbuyEl) maxbuyEl.textContent = maxBuyValue;
      if (gradeEl) gradeEl.textContent = "—";
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
    if (figuresEl) figuresEl.hidden = false;
    if (estimateEl) estimateEl.textContent = "No estimate";
    if (maxbuyEl) maxbuyEl.textContent = "—";
    if (gradeEl) gradeEl.textContent = "—";
    if (thumbEl) {
      thumbEl.style.backgroundImage = "";
      thumbEl.setAttribute("aria-label", "No catalog art");
    }
    if (scannerOn) {
      bandEl.setAttribute("aria-label", "CardFlow overlay, looking for a card");
      nameEl.textContent = "Looking for a card…";
      bodyEl.textContent = "Live-video identify is on.";
      return;
    }
    bandEl.setAttribute("aria-label", "CardFlow overlay, no card confirmed");
    nameEl.textContent = "Scanner off";
    bodyEl.textContent = "Turn the scanner on to identify from live video.";
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
