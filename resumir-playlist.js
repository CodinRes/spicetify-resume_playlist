(async function ResumePlaylistV4() {
  // Esperar a que todos los módulos necesarios de Spicetify estén disponibles
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

  // Obtenemos el nombre de la playlist si la API nativa está disponible
  async function getPlaylistName(playlistUri) {
    try {
      if (Spicetify.Platform?.PlaylistAPI?.getMetadata) {
        const meta = await Spicetify.Platform.PlaylistAPI.getMetadata(playlistUri);
        if (meta?.name) return meta.name;
      }
    } catch (e) {}
    return playlistUri.replace("spotify:playlist:", "Playlist: ");
  }

  // 1. Guardar la posición actual en segundo plano
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
          trackName: data.item.name || "Canción",
          index: index,
          timestamp: Date.now()
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
        console.log(`[ResumePlaylist] Guardado: "${data.item.name}" (Índice: ${index}) en ${contextUri}`);
      }
    } catch (e) {
      console.error("[ResumePlaylist] Error al guardar:", e);
    }
  }

  Spicetify.Player.addEventListener("songchange", saveCurrentPosition);
  Spicetify.Player.addEventListener("onprogress", saveCurrentPosition);
  setInterval(saveCurrentPosition, 3000);

  // 2. Reanudar la playlist desde el punto guardado
  async function resumePlaylist(rawUri) {
    if (!rawUri) return;
    const playlistUri = cleanUri(rawUri);
    const db = getDB();
    const saved = db[playlistUri];

    if (!saved || !saved.trackUri) {
      Spicetify.showNotification("No hay posición guardada para esta playlist.");
      Spicetify.Player.playUri(playlistUri);
      return;
    }

    isResuming = true;
    Spicetify.showNotification(`Reanudando: ${saved.trackName}`);

    const skipToOptions = {
      uri: saved.trackUri,
      trackUri: saved.trackUri,
      index: saved.index,
      trackIndex: saved.index,
      pageIndex: 0
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
      console.error("[ResumePlaylist] Error al ejecutar reproducción:", e);
      Spicetify.Player.playUri(playlistUri);
    } finally {
      setTimeout(() => {
        isResuming = false;
      }, 2500);
    }
  }

  // 3. Ventana Modal para ver historial y limpiar caché
  async function openHistoryModal() {
    const db = getDB();
    const keys = Object.keys(db);

    const container = document.createElement("div");
    container.style.padding = "10px";
    container.style.maxHeight = "400px";
    container.style.overflowY = "auto";
    container.style.color = "var(--spice-text, #fff)";

    if (keys.length === 0) {
      container.innerHTML = "<p style='text-align: center; color: #b3b3b3; padding: 20px;'>No hay canciones guardadas aún.</p>";
    } else {
      const list = document.createElement("div");
      list.style.display = "flex";
      list.style.flexDirection = "column";
      list.style.gap = "10px";

      for (const uri of keys) {
        const item = db[uri];
        const playlistName = await getPlaylistName(uri);

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
        trackDetails.textContent = `🎵 ${item.trackName || "Canción"}`;

        const posDetails = document.createElement("span");
        posDetails.style.fontSize = "11px";
        posDetails.style.color = "#b3b3b3";
        posDetails.textContent = `Posición actual: Canción #${(item.index ?? 0) + 1}`;

        infoDiv.appendChild(plTitle);
        infoDiv.appendChild(trackDetails);
        infoDiv.appendChild(posDetails);

        const playBtn = document.createElement("button");
        playBtn.textContent = "▶ Reanudar";
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

        itemRow.appendChild(infoDiv);
        itemRow.appendChild(playBtn);
        list.appendChild(itemRow);
      }
      container.appendChild(list);
    }

    // Botón inferior para limpiar caché
    const footer = document.createElement("div");
    footer.style.marginTop = "20px";
    footer.style.paddingTop = "14px";
    footer.style.borderTop = "1px solid rgba(255, 255, 255, 0.1)";
    footer.style.display = "flex";
    footer.style.justifyContent = "center";

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "🗑️ Eliminar caché de canciones guardadas";
    clearBtn.style.background = "#e91429";
    clearBtn.style.color = "#ffffff";
    clearBtn.style.border = "none";
    clearBtn.style.padding = "8px 16px";
    clearBtn.style.borderRadius = "20px";
    clearBtn.style.cursor = "pointer";
    clearBtn.style.fontWeight = "bold";
    clearBtn.onclick = () => {
      localStorage.removeItem(STORAGE_KEY);
      Spicetify.showNotification("Caché de Resume Playlist eliminada.");
      Spicetify.PopupModal.hide();
    };

    footer.appendChild(clearBtn);
    container.appendChild(footer);

    Spicetify.PopupModal.display({
      title: "Canciones Guardadas por Playlist",
      content: container
    });
  }

  // 4. Agregar la opción al menú desplegable del perfil (arriba a la derecha)
  new Spicetify.Menu.Item(
    "Ver playlists guardadas (Resume)",
    false,
    () => openHistoryModal()
  ).register();

  // 5. Opción en el menú de clic derecho sobre cualquier playlist
  new Spicetify.ContextMenu.Item(
    "Reanudar playlist",
    (uris) => uris?.[0] && resumePlaylist(uris[0]),
    (uris) => uris?.length === 1 && uris[0].includes("playlist"),
    "play"
  ).register();

  Spicetify.showNotification("Resume Playlist listo");
})();
