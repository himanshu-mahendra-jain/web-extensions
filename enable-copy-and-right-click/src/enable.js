(() => {
  const ENABLED_ATTRIBUTE =
    "data-enable-copy-right-click";

  const STYLE_ID =
    "enable-copy-right-click-style";


  if (
    document.documentElement.hasAttribute(
      ENABLED_ATTRIBUTE
    )
  ) {
    return;
  }


  document.documentElement.setAttribute(
    ENABLED_ATTRIBUTE,
    ""
  );


  const blockedEvents = [
    "contextmenu",
    "copy",
    "cut",
    "paste",
    "selectstart",
    "dragstart"
  ];


  const inlineAttributes = [
    "oncontextmenu",
    "oncopy",
    "oncut",
    "onpaste",
    "onselectstart",
    "ondragstart"
  ];


  function clearInlineHandlers(target) {
    if (!target) {
      return;
    }

    for (const attribute of inlineAttributes) {
      target.removeAttribute(attribute);
    }

    for (const eventName of blockedEvents) {
      target[`on${eventName}`] = null;
    }
  }


  clearInlineHandlers(
    document.documentElement
  );

  clearInlineHandlers(
    document.body
  );


  for (const eventName of blockedEvents) {
    window[`on${eventName}`] = null;
    document[`on${eventName}`] = null;

    window.addEventListener(
      eventName,
      (event) => {
        event.stopImmediatePropagation();
      },
      true
    );
  }


  if (!document.getElementById(STYLE_ID)) {
    const style =
      document.createElement("style");

    style.id = STYLE_ID;

    style.textContent = `
      * {
        -webkit-user-select: auto !important;
        user-select: auto !important;
      }
    `;

    (
      document.head ||
      document.documentElement
    ).appendChild(style);
  }


  function announceStatus() {
    if (window.self !== window.top) {
      return;
    }

    const announcement =
      document.createElement("div");

    announcement.setAttribute(
      "role",
      "status"
    );

    announcement.setAttribute(
      "aria-live",
      "polite"
    );

    // The text is in the browser's language, not the page's.
    announcement.lang =
      extensionApi.i18n.getUILanguage();

    announcement.dir =
      extensionApi.i18n.getMessage("@@bidi_dir") || "ltr";

    Object.assign(
      announcement.style,
      {
        position: "fixed",
        width: "1px",
        height: "1px",
        margin: "-1px",
        padding: "0",
        overflow: "hidden",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
        border: "0"
      }
    );

    (
      document.body ||
      document.documentElement
    ).appendChild(announcement);

    /*
     * Screen readers announce a change to a live region they
     * already know, not one that arrives with its text.
     */
    setTimeout(() => {
      announcement.textContent =
        extensionApi.i18n.getMessage("copyEnabled");
    }, 100);

    setTimeout(() => {
      announcement.remove();
    }, 1500);
  }

  announceStatus();
})();