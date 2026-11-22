(async function ResumePlaylistV3() {
  // Esperar a que las APIs de Spicetify estén listas
  while (!Spicetify?.Player || !Spicetify?.ContextMenu) {
    await new Promise((r) => setTimeout(r, 200));
  }

  const STORAGE_KEY = "spicetify_resume_playlist_v3";
  let isResuming = false; // Bloquea la sobreescritura durante el salto de canción

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

  // Guardar la posición actual en segundo plano
  function saveCurrentPosition() {
    if (isResuming) return; // Evita guardar mientras se ejecuta la acción de reanudar

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

  // Reanudar la playlist desde el punto guardado
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
    console.log(`[ResumePlaylist] Reanudando: "${saved.trackName}" (Índice: ${saved.index}) en ${playlistUri}`);

    // Objeto skipTo con múltiples propiedades para garantizar compatibilidad entre versiones
    const skipToOptions = {
      uri: saved.trackUri,
      trackUri: saved.trackUri,
      index: saved.index,
      trackIndex: saved.index,
      pageIndex: 0
    };

    try {
      // Pasar obligatoriamente el 2° argumento como objeto vacío (origins) y el 3° como las opciones
      if (Spicetify.Platform?.PlayerAPI?.play) {
        await Spicetify.Platform.PlayerAPI.play(
          { uri: playlistUri },
          {}, // 2° argumento: origins
          { skipTo: skipToOptions } // 3° argumento: options
        );
      } else {
        await Spicetify.Player.playUri(
          playlistUri,
          {}, // 2° argumento: context/origins
          { skipTo: skipToOptions } // 3° argumento: options
        );
      }
    } catch (e) {
      console.error("[ResumePlaylist] Error al ejecutar reproducción:", e);
      Spicetify.Player.playUri(playlistUri);
    } finally {
      // Liberar el bloqueo tras 2.5 segundos
      setTimeout(() => {
        isResuming = false;
      }, 2500);
    }
  }

  // Registrar en el menú desplegable del clic derecho
  new Spicetify.ContextMenu.Item(
    "Reanudar playlist",
    (uris) => uris?.[0] && resumePlaylist(uris[0]),
    (uris) => uris?.length === 1 && uris[0].includes("playlist"),
    "play"
  ).register();

  Spicetify.showNotification("Resume Playlist v3 activo");
})();