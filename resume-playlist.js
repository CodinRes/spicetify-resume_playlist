(async function ResumePlaylist() {
  // Esperar a que las APIs de Spicetify estén listas
  while (
    !Spicetify?.Player ||
    !Spicetify?.ContextMenu ||
    !Spicetify?.Menu ||
    !Spicetify?.PopupModal
  ) {
    await new Promise((r) => setTimeout(r, 200));
  }

  const STORAGE_KEY = "spicetify_resume_playlist_v3";
  let isResuming = false;

  // Detección de idioma (Español vs Inglés fallback)
  const userLang = (
    Spicetify?.Locale?.getLocale?.() ||
    navigator.language ||
    "en"
  ).toLowerCase();
  const isEs = userLang.startsWith("es");

  const t = {
    menuTitle: isEs ? "Ver playlists guardadas" : "View saved playlists (Resume)",
    contextMenuTitle: isEs ? "Reanudar playlist" : "Resume playlist",
    modalTitle: isEs ? "Canciones Guardadas por Playlist" : "Saved Songs by Playlist",
    noSaved: isEs ? "No hay canciones guardadas aún." : "No saved playlists yet.",
    noSavedNotif: isEs ? "No hay posición guardada para esta playlist." : "No saved position for this playlist.",
    resumingNotif: (name) => (isEs ? `Reanudando: ${name}` : `Resuming: ${name}`),
    activeNotif: isEs ? "Resume Playlist listo" : "Resume Playlist ready",
    clearAllBtn: isEs ? "🗑️ Eliminar todo el historial" : "🗑️ Clear all saved history",
    clearAllConfirm: isEs
      ? "¿Estás seguro de que deseas eliminar todo el historial guardado?"
      : "Are you sure you want to clear all saved history?",
    clearAllDone: isEs ? "Caché de Resume Playlist eliminada." : "Resume Playlist cache cleared.",
    deleteSingleConfirm: (name) =>
      isEs
        ? `¿Deseas eliminar la posición guardada de "${name}"?`
        : `Do you want to delete the saved position for "${name}"?`,
    deleteSingleDone: isEs ? "Posición eliminada correctamente." : "Saved position deleted.",
    playBtn: isEs ? "▶ Reanudar" : "▶ Resume",
    deleteBtnTitle: isEs ? "Eliminar esta posición guardada" : "Delete this saved position",
    positionText: (pos) => (isEs ? `Posición actual: Canción #${pos}` : `Current position: Track #${pos}`),
  };

  // SVG para el ícono del menú desplegable (estilo reloj/historial)
  const MENU_ICON_SVG = `<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5A6.51 6.5 0 0 0 8 1.5zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm9-3a.75.75 0 0 0-1.5 0v3.25c0 .2.08.39.22.53l2.25 2.25a.75.75 0 1 0 1.06-1.06L9 7.94V5z"/></svg>`;

  function getDB() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function cleanUri(uri) {
    if (!uri) return "";
    return uri.split("?")[0];
  }

  async function getPlaylistMetadata(playlistUri) {
    try {
      if (Spicetify.Platform?.PlaylistAPI?.getMetadata) {
        const meta = await Spicetify.Platform.PlaylistAPI.getMetadata(playlistUri);
        if (meta?.name) return meta.name;
      }
    } catch (e) {}
    return playlistUri.replace("spotify:playlist:", "Playlist: ");
  }

  // 1. Guardar la posición actual
  function saveCurrentPosition() {
    if (isResuming) return;

    try {
      const data = Spicetify.Player.data;
      if (!data?.item?.uri || !data?.context?.uri) return;

      const contextUri = cleanUri(data.context.uri);
      const trackUri = cleanUri(data.item.uri);

      if (!contextUri.includes("playlist")) return;

      let index = 0;
      if (typeof data.index === "number") index = data.index;
      else if (typeof data.index?.itemIndex === "number") index = data.index.itemIndex;
      else if (typeof data.index?.track === "number") index = data.index.track;

      const db = getDB();
      const lastSaved = db[contextUri];

      if (!lastSaved || lastSaved.trackUri !== trackUri) {
        db[contextUri] = {
          trackUri: trackUri,
          trackName: data.item.name || "Track",
          index: index,
          timestamp: Date.now(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
        console.log(`[ResumePlaylist] Saved: "${data.item.name}" at ${contextUri}`);
      }
    } catch (e) {
      console.error("[ResumePlaylist] Save error:", e);
    }
  }

  Spicetify.Player.addEventListener("songchange", saveCurrentPosition);
  Spicetify.Player.addEventListener("onprogress", saveCurrentPosition);
  setInterval(saveCurrentPosition, 3000);

  // 2. Reanudar la playlist
  async function resumePlaylist(rawUri) {
    if (!rawUri) return;
    const playlistUri = cleanUri(rawUri);
    const db = getDB();
    const saved = db[playlistUri];

    if (!saved || !saved.trackUri) {
      Spicetify.showNotification(t.noSavedNotif);
      Spicetify.Player.playUri(playlistUri);
      return;
    }

    isResuming = true;
    Spicetify.showNotification(t.resumingNotif(saved.trackName));

    const skipToOptions = {
      uri: saved.trackUri,
      trackUri: saved.trackUri,
      index: saved.index,
      trackIndex: saved.index,
      pageIndex: 0,
    };

    try {
      if (Spicetify.Platform?.PlayerAPI?.play) {
        await Spicetify.Platform.PlayerAPI.play(
          { uri: playlistUri },
          {},
          { skipTo: skipToOptions }
        );
      } else {
        await Spicetify.Player.playUri(
          playlistUri,
          {},
          { skipTo: skipToOptions }
        );
      }
    } catch (e) {
      console.error("[ResumePlaylist] Playback execution error:", e);
      Spicetify.Player.playUri(playlistUri);
    } finally {
      setTimeout(() => {
        isResuming = false;
      }, 2500);
    }
  }

  // 3. Ventana Modal con eliminación individual y masiva
  async function openHistoryModal() {
    const db = getDB();
    const keys = Object.keys(db);

    const container = document.createElement("div");
    container.style.padding = "10px";
    container.style.maxHeight = "400px";
    container.style.overflowY = "auto";
    container.style.color = "var(--spice-text, #fff)";

    if (keys.length === 0) {
      container.innerHTML = `<p style='text-align: center; color: #b3b3b3; padding: 20px;'>${t.noSaved}</p>`;
    } else {
      const list = document.createElement("div");
      list.style.display = "flex";
      list.style.flexDirection = "column";
      list.style.gap = "10px";

      for (const uri of keys) {
        const item = db[uri];
        const playlistName = await getPlaylistMetadata(uri);

        let realPosition = (item.index ?? 0) + 1;
        try {
          if (Spicetify.Platform?.PlaylistAPI?.getContents) {
            const contents = await Spicetify.Platform.PlaylistAPI.getContents(uri);
            const foundIdx = contents.items?.findIndex((track) => track.uri === item.trackUri);
            if (foundIdx !== undefined && foundIdx !== -1) {
              realPosition = foundIdx + 1;
            }
          }
        } catch (e) {}

        const itemRow = document.createElement("div");
        itemRow.style.display = "flex";
        itemRow.style.justifyContent = "space-between";
        itemRow.style.alignItems = "center";
        itemRow.style.background = "rgba(255, 255, 255, 0.05)";
        itemRow.style.padding = "12px 16px";
        itemRow.style.borderRadius = "8px";

        const infoDiv = document.createElement("div");
        infoDiv.style.display = "flex";
        infoDiv.style.flexDirection = "column";
        infoDiv.style.gap = "4px";

        const plTitle = document.createElement("span");
        plTitle.style.fontSize = "14px";
        plTitle.style.fontWeight = "bold";
        plTitle.style.color = "#1db954";
        plTitle.textContent = playlistName;

        const trackDetails = document.createElement("span");
        trackDetails.style.fontSize = "13px";
        trackDetails.style.color = "#ffffff";
        trackDetails.textContent = `🎵 ${item.trackName || "Track"}`;

        const posDetails = document.createElement("span");
        posDetails.style.fontSize = "11px";
        posDetails.style.color = "#b3b3b3";
        posDetails.textContent = t.positionText(realPosition);

        infoDiv.appendChild(plTitle);
        infoDiv.appendChild(trackDetails);
        infoDiv.appendChild(posDetails);

        // Grupo de botones (Reanudar + Borrar X)
        const btnGroup = document.createElement("div");
        btnGroup.style.display = "flex";
        btnGroup.style.alignItems = "center";
        btnGroup.style.gap = "8px";

        const playBtn = document.createElement("button");
        playBtn.textContent = t.playBtn;
        playBtn.style.background = "#1db954";
        playBtn.style.color = "#000000";
        playBtn.style.border = "none";
        playBtn.style.padding = "6px 14px";
        playBtn.style.borderRadius = "20px";
        playBtn.style.cursor = "pointer";
        playBtn.style.fontWeight = "bold";
        playBtn.onclick = () => {
          Spicetify.PopupModal.hide();
          resumePlaylist(uri);
        };

        const deleteSingleBtn = document.createElement("button");
        deleteSingleBtn.textContent = "✕";
        deleteSingleBtn.title = t.deleteBtnTitle;
        deleteSingleBtn.style.background = "rgba(233, 20, 41, 0.2)";
        deleteSingleBtn.style.color = "#e91429";
        deleteSingleBtn.style.border = "1px solid #e91429";
        deleteSingleBtn.style.width = "28px";
        deleteSingleBtn.style.height = "28px";
        deleteSingleBtn.style.borderRadius = "50%";
        deleteSingleBtn.style.cursor = "pointer";
        deleteSingleBtn.style.fontWeight = "bold";
        deleteSingleBtn.style.display = "flex";
        deleteSingleBtn.style.alignItems = "center";
        deleteSingleBtn.style.justifyContent = "center";
        deleteSingleBtn.style.transition = "all 0.2s ease";

        deleteSingleBtn.onmouseover = () => {
          deleteSingleBtn.style.background = "#e91429";
          deleteSingleBtn.style.color = "#ffffff";
        };
        deleteSingleBtn.onmouseout = () => {
          deleteSingleBtn.style.background = "rgba(233, 20, 41, 0.2)";
          deleteSingleBtn.style.color = "#e91429";
        };

        deleteSingleBtn.onclick = (e) => {
          e.stopPropagation();
          if (confirm(t.deleteSingleConfirm(playlistName))) {
            const currentDb = getDB();
            delete currentDb[uri];
            localStorage.setItem(STORAGE_KEY, JSON.stringify(currentDb));
            Spicetify.showNotification(t.deleteSingleDone);
            Spicetify.PopupModal.hide();
            openHistoryModal();
          }
        };

        btnGroup.appendChild(playBtn);
        btnGroup.appendChild(deleteSingleBtn);

        itemRow.appendChild(infoDiv);
        itemRow.appendChild(btnGroup);
        list.appendChild(itemRow);
      }
      container.appendChild(list);
    }

    // Pie con botón para limpiar toda la caché
    const footer = document.createElement("div");
    footer.style.marginTop = "20px";
    footer.style.paddingTop = "14px";
    footer.style.borderTop = "1px solid rgba(255, 255, 255, 0.1)";
    footer.style.display = "flex";
    footer.style.justifyContent = "center";

    const clearBtn = document.createElement("button");
    clearBtn.textContent = t.clearAllBtn;
    clearBtn.style.background = "#e91429";
    clearBtn.style.color = "#ffffff";
    clearBtn.style.border = "none";
    clearBtn.style.padding = "8px 16px";
    clearBtn.style.borderRadius = "20px";
    clearBtn.style.cursor = "pointer";
    clearBtn.style.fontWeight = "bold";

    clearBtn.onclick = () => {
      if (confirm(t.clearAllConfirm)) {
        localStorage.removeItem(STORAGE_KEY);
        Spicetify.showNotification(t.clearAllDone);
        Spicetify.PopupModal.hide();
      }
    };

    footer.appendChild(clearBtn);
    container.appendChild(footer);

    Spicetify.PopupModal.display({
      title: t.modalTitle,
      content: container,
    });
  }

  // 4. Menú de usuario (arriba a la derecha con ícono SVG)
  new Spicetify.Menu.Item(
    t.menuTitle,
    false,
    () => openHistoryModal(),
    MENU_ICON_SVG
  ).register();

  // 5. Menú contextual sobre playlist (clic derecho)
  new Spicetify.ContextMenu.Item(
    t.contextMenuTitle,
    (uris) => uris?.[0] && resumePlaylist(uris[0]),
    (uris) => uris?.length === 1 && uris[0].includes("playlist"),
    "play"
  ).register();

  Spicetify.showNotification(t.activeNotif);
})();
