// Applique le thème avant le premier rendu pour éviter tout clignotement.
// Script classique, chargé de façon bloquante dans <head>.
(function () {
  var theme = "auto";
  try {
    var raw = localStorage.getItem("basicqr.v2") || localStorage.getItem("basicqr.v1");
    if (raw) theme = JSON.parse(raw).theme || "auto";
  } catch (error) {
    /* stockage indisponible : on suit le système */
  }
  var resolved =
    theme === "light" || theme === "dark"
      ? theme
      : window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  document.documentElement.dataset.theme = resolved;
})();
