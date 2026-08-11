// KIDAPP.ORG PRO - INTERACTIVE CONTROLLER & CLOUD BACKEND CONNECTIVITY

// BACKEND API & WEBSOCKET CONFIGURATION
const BACKEND_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:4000' 
  : 'https://kidapp-backend.onrender.com';

const WS_URL = window.location.hostname === 'localhost' 
  ? 'ws://localhost:4000' 
  : 'wss://kidapp-backend.onrender.com';

let socket;

// STATE MANAGEMENT
const state = {
  isGlobalLocked: false,
  activeChild: null,
  children: [],
  remainingMinutes: 45,
  aiPendingRequests: 0,
  gpsStep: 0,
  gpsCoordinates: [
    { lat: 40.4168, lng: -3.7038, location: "Punto de Inicio", speed: "0 km/h", status: "inside" }
  ],
  appLimits: {
    Roblox: '1h30m',
    TikTok: '45m',
    WhatsApp: 'allowed',
    YouTube: '1h'
  },
  isAddingZoneMode: false,
  tempZoneLatLng: null,
  savedZones: [],
  chores: [],
  routines: []
};

let map;
let childMarker;
let tempZoneCircle;
const mapZoneLayers = new Map();

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  
  // Cargar hijos desde el Servidor Central (Render Cloud) y usar LocalStorage como respaldo
  fetch(`${BACKEND_URL}/api/children`)
    .then(res => res.json())
    .then(serverChildren => {
      if (serverChildren && serverChildren.length > 0) {
        mergeLocalSettings(serverChildren);
        state.children = serverChildren;
        renderChildrenSelector();
        
        const savedChild = localStorage.getItem('kidapp_active_child');
        if (savedChild && state.children.some(c => c.id === savedChild)) {
          selectChild(savedChild);
        } else {
          goHome();
        }
      } else {
        loadFromLocalStorageFallback();
      }
    })
    .catch(err => {
      console.warn('Usando respaldo de almacenamiento local:', err);
      loadFromLocalStorageFallback();
    });

  // Cargar zonas seguras desde el Servidor Central (Render Cloud) y usar LocalStorage como respaldo
  fetch(`${BACKEND_URL}/api/zones`)
    .then(res => res.json())
    .then(serverZones => {
      if (serverZones && serverZones.length > 0) {
        state.savedZones = serverZones;
        renderAllSavedZonesOnMap();
        renderSavedZonesList();
      } else {
        loadZonesFromLocalStorageFallback();
      }
    })
    .catch(err => {
      console.warn('Usando respaldo local para zonas:', err);
      loadZonesFromLocalStorageFallback();
    });

  checkAuthStatus();

  // Cargar minutos restantes persistidos
  const savedMins = localStorage.getItem('kidapp_remaining_minutes');
  if (savedMins !== null) {
    state.remainingMinutes = parseInt(savedMins);
  }
  const remTimeEl = document.getElementById('sim-rem-time');
  if (remTimeEl) remTimeEl.textContent = `${state.remainingMinutes} min`;
  const remBadgeEl = document.getElementById('rem-badge');
  if (remBadgeEl) remBadgeEl.textContent = `Restan ${state.remainingMinutes} min`;

  // Cargar tareas desde el Servidor Central (con fallback a localStorage)
  fetch(`${BACKEND_URL}/api/chores`)
    .then(res => res.json())
    .then(serverChores => {
      if (Array.isArray(serverChores)) {
        state.chores = serverChores;
        localStorage.setItem('kidapp_chores', JSON.stringify(state.chores));
      } else {
        loadChoresFromLocalStorageFallback();
      }
    })
    .catch(() => loadChoresFromLocalStorageFallback())
    .finally(() => renderChoresList());

  // Cargar rutinas desde el Servidor Central (con fallback a localStorage)
  fetch(`${BACKEND_URL}/api/routines`)
    .then(res => res.json())
    .then(serverRoutines => {
      if (Array.isArray(serverRoutines) && serverRoutines.length > 0) {
        state.routines = serverRoutines;
        localStorage.setItem('kidapp_routines', JSON.stringify(state.routines));
      } else {
        loadRoutinesFromLocalStorageFallback();
      }
    })
    .catch(() => loadRoutinesFromLocalStorageFallback())
    .finally(() => {
      renderRoutinesList();
      
      // Restaurar pestaña activa anterior al refrescar
      const savedTab = localStorage.getItem('kidapp_active_tab');
      if (savedTab) {
        switchTab(savedTab);
      }
    });
});
function mergeLocalSettings(childrenArray) {
  if (!childrenArray || childrenArray.length === 0) return;
  try {
    const savedLocal = localStorage.getItem('kidapp_children');
    if (savedLocal) {
      const localChildren = JSON.parse(savedLocal);
      childrenArray.forEach(sChild => {
        const lChild = localChildren.find(c => c.id === sChild.id);
        if (lChild) {
          if (lChild.contactsOnlyFilter !== undefined) sChild.contactsOnlyFilter = lChild.contactsOnlyFilter;
          if (lChild.webFilterEnabled !== undefined) sChild.webFilterEnabled = lChild.webFilterEnabled;
          if (lChild.webFilterCategories !== undefined) sChild.webFilterCategories = lChild.webFilterCategories;
        }
      });
    }
  } catch (e) {
    console.error("Error fusionando configuración local:", e);
  }
}

function loadFromLocalStorageFallback() {
  try {
    const saved = localStorage.getItem('kidapp_children');
    if (saved) {
      state.children = JSON.parse(saved);
      state.children.forEach(child => {
        // Auto-restaurar en el servidor central
        fetch(`${BACKEND_URL}/api/children`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ child })
        }).catch(e => console.error('Error restaurando hijo en servidor central:', e));
      });
      
      renderChildrenSelector();
      
      const savedChild = localStorage.getItem('kidapp_active_child');
      if (savedChild && state.children.some(c => c.id === savedChild)) {
        selectChild(savedChild);
      } else {
        goHome();
      }
    }
  } catch (e) {
    console.error('Error cargando hijos de LocalStorage:', e);
  }
}

function loadChoresFromLocalStorageFallback() {
  try {
    const saved = localStorage.getItem('kidapp_chores');
    if (saved) state.chores = JSON.parse(saved);
  } catch (e) {
    state.chores = [];
  }
}

function loadZonesFromLocalStorageFallback() {
  try {
    const saved = localStorage.getItem('kidapp_zones');
    if (saved) {
      state.savedZones = JSON.parse(saved);
      renderAllSavedZonesOnMap();
      renderSavedZonesList();
      // Auto-restaurar en el servidor central
      state.savedZones.forEach(zone => {
        fetch(`${BACKEND_URL}/api/zones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zone })
        }).catch(e => console.error('Error restaurando zona en servidor central:', e));
      });
    }
  } catch (e) {
    console.error('Error cargando zonas de LocalStorage:', e);
  }
}

// TOGGLE PASSWORD VISIBILITY (OJITO EMOJI REAL)
function togglePasswordVisibility() {
  const pwdInput = document.getElementById('dev-access-key');
  const eyeBtn = document.getElementById('btn-toggle-eye');
  if (!pwdInput) return;

  if (pwdInput.type === 'password') {
    pwdInput.type = 'text';
    if (eyeBtn) eyeBtn.textContent = '🙈';
  } else {
    pwdInput.type = 'password';
    if (eyeBtn) eyeBtn.textContent = '👁️';
  }
}

// AUTHENTICATION & DEVELOPER LOCK CONTROLLER
function checkAuthStatus() {
  const token = localStorage.getItem('kidapp_dev_token');
  const authModal = document.getElementById('auth-modal-screen');
  const mainContent = document.getElementById('main-app-content');

  if (token === 'granted_kidapp77') {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    if (authModal) {
      authModal.classList.remove('active');
      authModal.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; z-index: -9999 !important;';
    }
    if (mainContent) {
      mainContent.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important;';
    }
    try {
      initMap();
      initWebSocket();
    } catch (e) {
      console.error('Error en checkAuthStatus:', e);
    }
  } else {
    if (authModal) {
      authModal.classList.add('active');
      authModal.style.cssText = 'display: flex !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; z-index: 999999 !important;';
    }
    if (mainContent) {
      mainContent.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important;';
    }
  }
}

function handleDevAccess(event) {
  if (event) event.preventDefault();
  const inputEl = document.getElementById('dev-access-key');
  const inputKey = inputEl ? inputEl.value.trim() : '';
  const errorMsg = document.getElementById('access-error-msg');

  // Deja únicamente Kidapp77! por seguridad
  if (inputKey === 'Kidapp77!') {
    if (errorMsg) errorMsg.style.display = 'none';
    localStorage.setItem('kidapp_dev_token', 'granted_kidapp77');

    if ('Notification' in window) {
      Notification.requestPermission();
    }

    const authModal = document.getElementById('auth-modal-screen');
    if (authModal) {
      authModal.classList.remove('active');
      authModal.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; z-index: -9999 !important;';
    }
    const mainContent = document.getElementById('main-app-content');
    if (mainContent) {
      mainContent.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important;';
    }

    try {
      initMap();
      initWebSocket();
    } catch (e) {
      console.error('Error al desbloquear:', e);
    }
  } else {
    if (errorMsg) errorMsg.style.display = 'block';
    if (inputEl) {
      inputEl.value = '';
      inputEl.focus();
    }
  }
}

function handleLogout() {
  const modal = document.getElementById('logout-confirm-modal');
  const confirmBtn = document.getElementById('btn-confirm-logout');

  if (!modal || !confirmBtn) {
    // Fallback legado si no se encuentran los elementos del modal
    if (confirm('¿Deseas salir y bloquear el panel de control?')) {
      executeLogoutAction();
    }
    return;
  }

  confirmBtn.onclick = function() {
    executeLogoutAction();
  };

  modal.classList.add('active');
  lucide.createIcons();
}

function closeLogoutConfirmModal() {
  const modal = document.getElementById('logout-confirm-modal');
  if (modal) modal.classList.remove('active');
}

function executeLogoutAction() {
  localStorage.removeItem('kidapp_dev_token');
  window.location.reload();
}

// WEBSOCKET REAL-TIME CONNECTIVITY TO RENDER CLOUD
function initWebSocket() {
  console.log(`🔌 Conectando WebSocket a ${WS_URL}...`);
  try {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      console.log('⚡ Conectado con éxito al Servidor Backend de KidApp.org en la nube!');
      socket.send(JSON.stringify({ type: 'PING' }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Mensaje recibido del servidor en la nube:', data);

        if (data.type === 'GLOBAL_LOCK_UPDATE') {
          handleRemoteLockUpdate(data.isLocked, data.reason);
        } else if (data.type === 'NEW_AMBIENT_AUDIO') {
          handleNewAmbientAudio(data.audioUrl, data.timestamp);
        } else if (data.type === 'GPS_UPDATE') {
          handleRealTimeGpsUpdate(data.lat, data.lng, data.speed, data.timestamp, data.battery);
        } else if (data.type === 'DEVICE_PAIRED') {
          handleDevicePairedEvent(data.child);
        } else if (data.type === 'INIT_STATE') {
          console.log('Estado inicial recibido de la nube:', data.children);
          if (data.children) {
            mergeLocalSettings(data.children);
            state.children = data.children;
            renderChildrenSelector();
            
            const savedChild = localStorage.getItem('kidapp_active_child');
            if (savedChild && state.children.some(c => c.id === savedChild)) {
              selectChild(savedChild);
            } else {
              goHome();
            }
          }
          if (data.zones) {
            state.savedZones = data.zones;
            renderAllSavedZonesOnMap();
            renderSavedZonesList();
          }
          if (data.eventLog && data.eventLog.length > 0) {
            const feed = document.getElementById('activity-feed');
            if (feed) {
              feed.innerHTML = '';
              for (let i = data.eventLog.length - 1; i >= 0; i--) {
                const ev = data.eventLog[i];
                let typeIcon = 'ai';
                if (ev.type === 'web_block') typeIcon = 'shield';
                else if (ev.type === 'sos_alert') typeIcon = 'lock';
                else if (ev.title.includes('GPS') || ev.title.includes('ZONA')) typeIcon = 'gps';
                
                let timeText = 'Hace un momento';
                if (ev.time) {
                  const d = new Date(ev.time);
                  timeText = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
                }
                addActivityFeedItem(typeIcon, ev.title, timeText);
              }
            }
          }
        } else if (data.type === 'ZONE_ADDED') {
          console.log('Zona añadida remotamente:', data.zone);
          if (state.savedZones && !state.savedZones.some(z => z.id === data.zone.id)) {
            state.savedZones.push(data.zone);
            renderAllSavedZonesOnMap();
            renderSavedZonesList();
            try {
              localStorage.setItem('kidapp_zones', JSON.stringify(state.savedZones));
            } catch (e) {}
          }
        } else if (data.type === 'ZONE_DELETED') {
          console.log('Zona eliminada remotamente:', data.zoneId);
          state.savedZones = state.savedZones.filter(z => z.id !== data.zoneId);
          renderAllSavedZonesOnMap();
          renderSavedZonesList();
          try {
            localStorage.setItem('kidapp_zones', JSON.stringify(state.savedZones));
          } catch (e) {}
        } else if (data.type === 'ZONE_TOGGLED') {
          console.log('Zona habilitada/deshabilitada remotamente:', data.zoneId, data.enabled);
          const zone = state.savedZones.find(z => z.id === data.zoneId);
          if (zone) {
            zone.enabled = data.enabled;
            renderAllSavedZonesOnMap();
            renderSavedZonesList();
            try {
              localStorage.setItem('kidapp_zones', JSON.stringify(state.savedZones));
            } catch (e) {}
          }
        } else if (data.type === 'CHILD_ADDED') {
          console.log('Hijo añadido remótamente desde otro dispositivo:', data.child);
          if (state.children && !state.children.some(c => c.id === data.child.id)) {
            state.children.push(data.child);
            renderChildrenBar(data.child);
            try {
              localStorage.setItem('kidapp_children', JSON.stringify(state.children));
            } catch (e) {}
          }
        } else if (data.type === 'CHILD_DELETED') {
          console.log('Hijo eliminado remótamente desde otro dispositivo:', data.childId);
          if (state.children) {
            state.children = state.children.filter(c => c.id !== data.childId);
            try {
              localStorage.setItem('kidapp_children', JSON.stringify(state.children));
            } catch (e) {}
          }
          const card = document.getElementById(`card-${data.childId}`);
          if (card) card.remove();
          if (state.activeChild === data.childId) {
            state.activeChild = (state.children && state.children.length > 0) ? state.children[0].id : null;
            if (state.activeChild) switchChild(state.activeChild);
          }
          if (!state.children || state.children.length === 0) {
            localStorage.removeItem('kidapp_zones');
            localStorage.removeItem('kidapp_chores');
            localStorage.removeItem('kidapp_routines');
            localStorage.removeItem('kidapp_remaining_minutes');
            localStorage.removeItem('kidapp_active_child');
            setTimeout(() => {
              window.location.reload();
            }, 300);
          }
        } else if (data.type === 'CLEARED_ALL_DATA') {
          console.log('Todos los datos han sido eliminados por desvinculación completa.');
          localStorage.removeItem('kidapp_children');
          localStorage.removeItem('kidapp_zones');
          localStorage.removeItem('kidapp_chores');
          localStorage.removeItem('kidapp_routines');
          localStorage.removeItem('kidapp_remaining_minutes');
          localStorage.removeItem('kidapp_active_child');
          setTimeout(() => {
            window.location.reload();
          }, 300);
        } else if (data.type === 'CHORE_ADDED') {
          // Tarea nueva creada desde otro dispositivo
          if (!state.chores) state.chores = [];
          if (!state.chores.some(c => c.id === data.chore.id)) {
            state.chores.push(data.chore);
            localStorage.setItem('kidapp_chores', JSON.stringify(state.chores));
            renderChoresList();
            addActivityFeedItem('ai', `📋 <strong>NUEVA MISIÓN RECIBIDA:</strong> ${data.chore.name} (+${data.chore.reward} min).`, 'Justo ahora');
          }
        } else if (data.type === 'CHORE_APPROVED') {
          // Tarea aprobada desde otro dispositivo
          if (state.chores) {
            const chore = state.chores.find(c => c.id === data.choreId);
            if (chore && !chore.completed) {
              chore.completed = true;
              state.remainingMinutes += chore.reward;
              localStorage.setItem('kidapp_chores', JSON.stringify(state.chores));
              localStorage.setItem('kidapp_remaining_minutes', state.remainingMinutes);
              const remTimeEl = document.getElementById('sim-rem-time');
              if (remTimeEl) remTimeEl.textContent = `${state.remainingMinutes} min`;
              const remBadgeEl = document.getElementById('rem-badge');
              if (remBadgeEl) remBadgeEl.textContent = `Restan ${state.remainingMinutes} min`;
              renderChoresList();
            }
          }
        } else if (data.type === 'ROUTINES_UPDATED') {
          // Rutinas actualizadas desde otro dispositivo
          if (Array.isArray(data.routines)) {
            state.routines = data.routines;
            localStorage.setItem('kidapp_routines', JSON.stringify(state.routines));
            renderRoutinesList();
          }
        } else if (data.type === 'APP_LIMITS_UPDATE') {
          // Límites de aplicaciones actualizados desde otro dispositivo o dispositivo del hijo
          const child = state.children.find(c => c.id === data.childId);
          if (child) {
            child.appLimits = data.appLimits;
            localStorage.setItem('kidapp_children', JSON.stringify(state.children));
            if (state.activeChild === data.childId) {
              renderAppLimitsList();
            }
          }
        } else if (data.type === 'INSTALLED_APPS_REPORT') {
          // Reporte de aplicaciones instaladas recibido desde el móvil del hijo
          const child = state.children.find(c => c.id === data.childId);
          if (child) {
            child.installedApps = data.apps;
            localStorage.setItem('kidapp_children', JSON.stringify(state.children));
            if (state.activeChild === data.childId) {
              renderAppLimitsList();
            }
            addActivityFeedItem('ai', `📱 <strong>APPS SINCRO:</strong> Móvil de ${child.name} sincronizó ${data.apps.length} apps instaladas.`, 'Justo ahora');
          }
        } else if (data.type === 'APP_USAGE_UPDATE') {
          // Uso de aplicación actualizado en tiempo real desde el móvil del hijo
          const child = state.children.find(c => c.id === data.childId);
          if (child) {
            if (!child.appUsage) child.appUsage = {};
            const key = data.packageName || data.appName;
            if (key) {
              child.appUsage[key] = data.seconds;
            }
            localStorage.setItem('kidapp_children', JSON.stringify(state.children));
            if (state.activeChild === data.childId) {
              renderAppLimitsList();
            }
          }
        } else if (data.type === 'WEB_FILTER_BLOCK_ALERT') {
          addActivityFeedItem('shield', data.event.title, 'Justo ahora');
        } else if (data.type === 'SOS_ALERT') {
          handleIncomingSosAlert(data);
        } else if (data.type === 'CALL_REQUEST') {
          handleIncomingCallRequest(data);
        }
      } catch (e) {
        console.error('Error procesando mensaje WebSocket:', e);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket desconectado. Reintentando en 5 segundos...');
      setTimeout(initWebSocket, 5000);
    };
  } catch (err) {
    console.error('Error iniciando WebSocket:', err);
  }
}

// CLOCK SIMULATOR
function initClock() {
  const updateTime = () => {
    const now = new Date();
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const clockEl = document.getElementById('phone-clock');
    if (clockEl) clockEl.textContent = `${hrs}:${mins}`;
  };
  updateTime();
  setInterval(updateTime, 10000);
}

// MAP INITIALIZATION (LEAFLET)
function initMap() {
  const mapContainer = document.getElementById('leaflet-map');
  if (!mapContainer || map) return;

  const initialPos = state.gpsCoordinates[0];
  map = L.map('leaflet-map', {
    scrollWheelZoom: false, // Desactivar zoom con rueda en PC para evitar saltos molestos de scroll
    tap: !L.Browser.mobile
  }).setView([initialPos.lat, initialPos.lng], 15);

  // Evitar secuestro de scroll en móviles: solo permitir mover el mapa con 2 dedos
  if (L.Browser.mobile) {
    map.dragging.disable();
    map.on('touchstart', function (e) {
      if (e.originalEvent.touches.length >= 2) {
        map.dragging.enable();
      } else {
        map.dragging.disable();
      }
    });
    map.on('touchend', function () {
      map.dragging.disable();
    });
  }

  // Light tiles for clean friendly aesthetic
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19
  }).addTo(map);

  // Custom Icon for Lucas
  const childIcon = L.divIcon({
    className: 'custom-child-marker',
    html: '<div style="background: #2563eb; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; border: 3px solid white; box-shadow: 0 4px 12px rgba(37,99,235,0.4);">👦</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  const name = activeChild ? activeChild.name : 'Hijo';
  const batteryStr = activeChild && activeChild.battery !== undefined ? ` 🔋 ${activeChild.battery}%` : '';
  childMarker = L.marker([initialPos.lat, initialPos.lng], { icon: childIcon }).addTo(map);
  childMarker.bindPopup(`<b>${name}${batteryStr}</b><br>📍 Coord: ${initialPos.lat.toFixed(4)}, ${initialPos.lng.toFixed(4)}`, { autoPan: false }).openPopup();

  // CAPTURA DE CLICS EN EL MAPA PARA CREAR ZONAS SEGURAS
  map.on('click', (e) => {
    if (state.isAddingZoneMode) {
      setTempZonePoint(e.latlng.lat, e.latlng.lng);
    }
  });

  // Dibujar zonas seguras guardadas inicialmente
  renderAllSavedZonesOnMap();
  renderSavedZonesList();

  // Inicializar slider y textos de rebobinado de ruta
  try {
    const routePoints = getRouteHistoryForActiveChild();
    const slider = document.getElementById('playback-slider');
    if (slider) {
      slider.max = routePoints.length - 1;
      slider.value = 0;
    }
    const statusText = document.getElementById('playback-status-text');
    if (statusText) {
      statusText.textContent = `Listo para rebobinar ruta (${routePoints.length} puntos)`;
    }
  } catch (e) {
    console.error('Error al inicializar rebobinado en mapa:', e);
  }
}

// CONTROLADOR MODO CREAR ZONA EN EL MAPA
function toggleAddZoneMode() {
  state.isAddingZoneMode = !state.isAddingZoneMode;
  const formCard = document.getElementById('new-zone-form-card');
  const btnToggle = document.getElementById('btn-toggle-add-zone');
  const mapContainer = document.getElementById('leaflet-map');

  if (state.isAddingZoneMode) {
    if (formCard) formCard.style.display = 'block';
    if (btnToggle) btnToggle.innerHTML = '<i data-lucide="x-circle"></i> <span>Cancelar</span>';
    if (mapContainer) mapContainer.style.cursor = 'crosshair';
    showToast('📍 Modo zona activo: Haz clic sobre el mapa para colocar el círculo.', 'success', 4000);
  } else {
    cancelAddZone();
  }
  lucide.createIcons();
}

// BUSCADOR DE DIRECCIONES CONCRETAS EN EL MAPA (OPENSEARCH NOMINATIM)
function searchAddressOnMap() {
  const inputEl = document.getElementById('map-address-search-input');
  if (!inputEl || !inputEl.value.trim()) {
    showToast('⚠️ Escribe una dirección para buscar en el mapa.', 'error');
    return;
  }

  const query = encodeURIComponent(inputEl.value.trim());
  const searchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${query}`;

  fetch(searchUrl)
    .then(res => res.json())
    .then(results => {
      if (results && results.length > 0) {
        const topResult = results[0];
        const lat = parseFloat(topResult.lat);
        const lng = parseFloat(topResult.lon);

        if (map) {
          map.setView([lat, lng], 16);
        }

        if (!state.isAddingZoneMode) {
          toggleAddZoneMode();
        }
        setTempZonePoint(lat, lng);

        const nameInput = document.getElementById('zone-name-input');
        if (nameInput) {
          nameInput.value = topResult.display_name.split(',')[0] || "Zona Buscada";
        }
      } else {
        showToast('❌ No se encontraron resultados.', 'error');
      }
    })
    .catch(err => {
      console.error('Error buscando dirección:', err);
      showToast('❌ Error en la búsqueda de la dirección.', 'error');
    });
}

function setTempZonePoint(lat, lng) {
  state.tempZoneLatLng = { lat, lng };
  const radiusInput = document.getElementById('zone-radius-input');
  const radius = radiusInput ? parseInt(radiusInput.value) : 200;

  if (tempZoneCircle) {
    map.removeLayer(tempZoneCircle);
  }

  tempZoneCircle = L.circle([lat, lng], {
    color: '#0284c7',
    fillColor: '#0284c7',
    fillOpacity: 0.25,
    dashArray: '6, 6',
    radius: radius
  }).addTo(map);

  map.panTo([lat, lng]);

  const nameInput = document.getElementById('zone-name-input');
  if (nameInput && !nameInput.value) {
    nameInput.value = "Nueva Zona Segura";
  }
}

function updateTempZoneRadius(radiusMeters) {
  const radiusVal = document.getElementById('zone-radius-val');
  if (radiusVal) radiusVal.textContent = `${radiusMeters} metros`;

  if (tempZoneCircle) {
    tempZoneCircle.setRadius(parseInt(radiusMeters));
  }
}

function saveNewZone() {
  const nameInput = document.getElementById('zone-name-input');
  const radiusInput = document.getElementById('zone-radius-input');

  const zoneName = nameInput ? nameInput.value.trim() : 'Zona Segura';
  const radius = radiusInput ? parseInt(radiusInput.value) : 200;

  if (!state.tempZoneLatLng) {
    showToast('⚠️ Por favor, haz clic sobre el mapa para ubicar la zona.', 'error');
    return;
  }

  const newZone = {
    id: `z_${Date.now()}`,
    name: zoneName || 'Zona Segura',
    lat: state.tempZoneLatLng.lat,
    lng: state.tempZoneLatLng.lng,
    radius: radius,
    isInside: false
  };

  state.savedZones.push(newZone);
  cancelAddZone();
  renderAllSavedZonesOnMap();
  renderSavedZonesList();

  // Persistir en LocalStorage
  try {
    localStorage.setItem('kidapp_zones', JSON.stringify(state.savedZones));
  } catch (e) {
    console.error('Error guardando zonas en LocalStorage:', e);
  }

  // Persistir en el Servidor Central (Render Cloud)
  try {
    fetch(`${BACKEND_URL}/api/zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: newZone })
    }).catch(err => console.error('Error sincronizando zona con el servidor central:', err));
  } catch (e) {
    console.error('Error disparando fetch central de zonas:', e);
  }

  // Mostrar modal estilizado en vez del alert nativo
  const modal = document.getElementById('zone-created-modal');
  const desc = document.getElementById('zone-created-modal-desc');
  if (modal && desc) {
    desc.innerHTML = `La zona segura <strong>📍 ${newZone.name}</strong> con un radio de <strong>${radius} metros</strong> ha sido guardada e integrada con éxito en el sistema GPS.`;
    modal.classList.add('active');
  } else {
    showToast(`✅ Zona "${newZone.name}" creada.`, 'success');
  }

  addActivityFeedItem('gps', `📍 <strong>NUEVA ZONA SEGURA CREADA:</strong> ${newZone.name} (Radio ${radius}m).`, 'Justo ahora');
}

function closeZoneCreatedModal() {
  const modal = document.getElementById('zone-created-modal');
  if (modal) modal.classList.remove('active');
}

function cancelAddZone() {
  state.isAddingZoneMode = false;
  state.tempZoneLatLng = null;

  if (tempZoneCircle) {
    map.removeLayer(tempZoneCircle);
    tempZoneCircle = null;
  }

  const formCard = document.getElementById('new-zone-form-card');
  const btnToggle = document.getElementById('btn-toggle-add-zone');
  const mapContainer = document.getElementById('leaflet-map');

  if (formCard) formCard.style.display = 'none';
  if (btnToggle) btnToggle.innerHTML = '<i data-lucide="plus-circle"></i> <span>Añadir Nueva Zona Segura</span>';
  if (mapContainer) mapContainer.style.cursor = '';

  const nameInput = document.getElementById('zone-name-input');
  if (nameInput) nameInput.value = '';
  lucide.createIcons();
}

function renderAllSavedZonesOnMap() {
  if (!map) return;

  // Limpiar capas previas
  mapZoneLayers.forEach(layer => map.removeLayer(layer));
  mapZoneLayers.clear();

  state.savedZones.forEach(zone => {
    const isEnabled = zone.enabled !== false;
    const color = isEnabled ? '#10b981' : '#64748b'; // Verde si está habilitada, gris si está deshabilitada
    const circle = L.circle([zone.lat, zone.lng], {
      color: color,
      fillColor: color,
      fillOpacity: isEnabled ? 0.15 : 0.08,
      radius: zone.radius
    }).addTo(map);

    circle.bindPopup(`<b>📍 Zona Segura: ${zone.name}</b><br>Radio de alerta: ${zone.radius} metros<br>Estado: <b>${isEnabled ? 'Alertas Activas' : 'Alertas Desactivadas'}</b>`);
    mapZoneLayers.set(zone.id, circle);
  });
}

function renderSavedZonesList() {
  const container = document.getElementById('saved-zones-list');
  if (!container) return;

  if (state.savedZones.length === 0) {
    container.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:10px;">No hay zonas seguras creadas aún.</p>`;
    return;
  }

  container.innerHTML = state.savedZones.map(zone => {
    const isEnabled = zone.enabled !== false;
    return `
      <div class="zone-item-premium ${zone.isInside && isEnabled ? 'active' : ''}" style="opacity: ${isEnabled ? 1 : 0.75};">
        <div class="zone-info-premium">
          <div class="zone-header-premium">
            <span class="zone-icon-premium"><i data-lucide="map-pin"></i></span>
            <span class="zone-title-premium" style="${isEnabled ? '' : 'text-decoration: line-through; color: #94a3b8;'}">${zone.name}</span>
          </div>
          <div class="zone-details-premium">
            <span class="zone-detail-item"><i data-lucide="radio" style="width:12px; height:12px;"></i> Radio: <strong>${zone.radius}m</strong></span>
            <span class="zone-detail-item"><i data-lucide="${isEnabled ? 'bell' : 'bell-off'}" style="width:12px; height:12px;"></i> Alertas: <strong>${isEnabled ? 'Activas' : 'Silenciadas'}</strong></span>
          </div>
        </div>
        <div class="zone-actions-premium">
          <div>
            ${isEnabled ? `
              <span class="badge-status-premium ${zone.isInside ? 'inside' : 'outside'}">
                <span class="pulse-dot"></span> ${zone.isInside ? 'Dentro' : 'Fuera'}
              </span>
            ` : `
              <span class="badge-status-premium silenced">
                Silenciada
              </span>
            `}
          </div>
          <div style="display:flex; justify-content: flex-end; align-items:center; gap:8px; margin-top: 8px;">
            <button onclick="toggleZoneAlerts('${zone.id}', ${!isEnabled})" class="zone-btn-action-premium ${isEnabled ? 'enabled' : 'disabled'}" title="${isEnabled ? 'Silenciar alertas' : 'Activar alertas'}">
              <i data-lucide="${isEnabled ? 'bell' : 'bell-off'}"></i>
            </button>
            <button onclick="deleteSavedZone('${zone.id}')" class="zone-btn-action-premium delete" title="Eliminar zona">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function toggleZoneAlerts(zoneId, enabled) {
  const zone = state.savedZones.find(z => z.id === zoneId);
  if (zone) {
    zone.enabled = enabled;
    renderAllSavedZonesOnMap();
    renderSavedZonesList();

    // Persistir localmente
    try {
      localStorage.setItem('kidapp_zones', JSON.stringify(state.savedZones));
    } catch (e) {}

    // Notificar al servidor en la nube
    try {
      fetch(`${BACKEND_URL}/api/zones/${zoneId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      }).catch(err => console.error('Error enviando toggle al servidor central:', err));
    } catch (e) {
      console.error('Error disparando fetch toggle de zona:', e);
    }
    
    showToast(enabled ? "🔔 Alertas activadas para la zona." : "🔕 Alertas silenciadas para esta zona.", "success");
  }
}

let zoneIdToDelete = null;

function deleteSavedZone(zoneId) {
  zoneIdToDelete = zoneId;
  const modal = document.getElementById('delete-zone-modal');
  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
  } else {
    // FALLBACK: Si el navegador tiene en caché el index.html viejo y no encuentra el modal, usar confirm nativo
    console.warn("⚠️ delete-zone-modal no encontrado en el DOM. Usando fallback confirm().");
    if (confirm('¿Deseas eliminar esta Zona Segura?')) {
      executeDeleteZone(zoneId);
    }
  }
}

function confirmDeleteZoneClick() {
  if (zoneIdToDelete) {
    executeDeleteZone(zoneIdToDelete);
  }
  closeDeleteZoneModal();
}

function closeDeleteZoneModal() {
  const modal = document.getElementById('delete-zone-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
  zoneIdToDelete = null;
}

function executeDeleteZone(zoneId) {
  state.savedZones = state.savedZones.filter(z => z.id !== zoneId);
  renderAllSavedZonesOnMap();
  renderSavedZonesList();

  // Persistir en LocalStorage
  try {
    localStorage.setItem('kidapp_zones', JSON.stringify(state.savedZones));
  } catch (e) {}

  // Eliminar en el Servidor Central (Render Cloud)
  try {
    fetch(`${BACKEND_URL}/api/zones/${zoneId}`, {
      method: 'DELETE'
    }).catch(err => console.error('Error eliminando zona en el servidor central:', err));
  } catch (e) {
    console.error('Error disparando delete central de zonas:', e);
  }
  showToast("🗑️ Zona Segura eliminada correctamente.", "success");
}

// MOTOR MATEMÁTICO HAVERSINE PARA DETECTAR ENTRADA/SALIDA DE ZONAS SEGURAS
function checkGeofences(lat, lng) {
  const activeCard = document.getElementById(`card-${state.activeChild}`);
  const childName = activeCard ? (activeCard.querySelector('.name')?.textContent || 'El hijo') : 'El hijo';

  state.savedZones.forEach(zone => {
    const distanceMeters = getDistanceMeters(lat, lng, zone.lat, zone.lng);
    const wasInside = zone.isInside;
    const isNowInside = distanceMeters <= zone.radius;

    if (!wasInside && isNowInside) {
      zone.isInside = true;
      renderSavedZonesList();
      showFloatingPushNotification('inside', '🟢 ENTRADA EN ZONA SEGURA', `${childName} ha entrado en la zona: ${zone.name}`);
      addActivityFeedItem('gps', `🟢 <strong>ENTRADA EN ZONA SEGURA:</strong> ${childName} ha llegado a <strong>${zone.name}</strong>.`, 'Justo ahora');
    } else if (wasInside && !isNowInside) {
      zone.isInside = false;
      renderSavedZonesList();
      showFloatingPushNotification('outside', '⚠️ ALERTA: SALIDA DE ZONA SEGURA', `${childName} ha SALIDO de la zona segura: ${zone.name}`);
      addActivityFeedItem('gps', `⚠️ <strong>SALIDA DE ZONA SEGURA:</strong> ${childName} ha salido de <strong>${zone.name}</strong>.`, 'Justo ahora');
    }
  });
}

// NOTIFICACIÓN FLOTANTE ESTILO WHATSAPP/PUSH CON RUIDO DE ALERTA DE EMERGENCIA
function showFloatingPushNotification(type, title, message) {
  playGeofenceAudioAlert(type);

  // 1. Notificación Nativa del Navegador/Móvil si está permitida (Persistente con requireInteraction)
  if ('Notification' in window && Notification.permission === 'granted') {
    const notifOptions = {
      body: message,
      icon: 'https://img.icons8.com/color/192/shield.png',
      badge: 'https://img.icons8.com/color/96/shield.png',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true, // Queda fija en el cajón de notificaciones hasta que se descarte
      tag: 'kidapp-alert-channel'
    };

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, notifOptions);
      }).catch(() => {
        new Notification(title, notifOptions);
      });
    } else {
      new Notification(title, notifOptions);
    }
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission();
  }

  // 2. Tarjeta Flotante Push dentro de la PWA (Estilo WhatsApp)
  const existingToast = document.getElementById('floating-whatsapp-toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.id = 'floating-whatsapp-toast';
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    width: 90%;
    max-width: 420px;
    background: ${type === 'outside' ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' : 'linear-gradient(135deg, #065f46 0%, #047857 100%)'};
    color: white;
    padding: 14px 18px;
    border-radius: 18px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.35);
    border: 2px solid ${type === 'outside' ? '#ef4444' : '#10b981'};
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 12px;
    animation: slideDownToast 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    font-family: 'Plus Jakarta Sans', sans-serif;
  `;

  toast.innerHTML = `
    <div style="font-size: 1.8rem; flex-shrink: 0; background: rgba(255,255,255,0.15); width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
      ${type === 'outside' ? '⚠️' : '🟢'}
    </div>
    <div style="flex: 1;">
      <div style="font-size: 0.72rem; opacity: 0.8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
        KidApp Push • Justo Ahora
      </div>
      <div style="font-weight: 800; font-size: 0.95rem; color: ${type === 'outside' ? '#fca5a5' : '#a7f3d0'};">
        ${title}
      </div>
      <div style="font-size: 0.82rem; opacity: 0.95; margin-top: 2px;">
        ${message}
      </div>
    </div>
    <button onclick="this.parentElement.remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-weight: 800; font-size: 0.9rem; display: flex; align-items: center; justify-content: center;">
      ✕
    </button>
  `;

  document.body.appendChild(toast);

  // Auto-eliminar tras 10 segundos
  setTimeout(() => {
    if (document.body.contains(toast)) {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.5s ease';
      setTimeout(() => toast.remove(), 500);
    }
  }, 10000);
}

// SINTETIZADOR DE RUIDO Y SONIDO DE ALERTA DE EMERGENCIA (WEB AUDIO API)
function playGeofenceAudioAlert(type) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    if (type === 'outside') {
      // Pitido doble estridente de alerta de salida de zona
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(880, ctx.currentTime); // A5
      gain1.gain.setValueAtTime(0.3, ctx.currentTime);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.2);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.25); // D6
      gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.25);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.25);
      osc2.stop(ctx.currentTime + 0.55);
    } else {
      // Tono agradable de entrada en zona segura
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.3); // C6
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    console.error('Error sintetizando sonido de alerta:', e);
  }
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// REAL-TIME GPS UPDATE FROM CHILD DEVICE
function handleRealTimeGpsUpdate(lat, lng, speed, timestamp, battery) {
  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);
  const newPos = [numLat, numLng];

  // Guardar la ubicación en vivo real en segundo plano
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  const childDevice = activeChild ? activeChild.device : 'Smartphone';
  realTimeGps = {
    lat: numLat,
    lng: numLng,
    speed: speed || '0 km/h',
    timestamp: timestamp || 'En vivo',
    device: childDevice
  };

  // Actualizar batería en directo si viene en el ping de geolocalización
  if (battery !== undefined && activeChild) {
    activeChild.battery = battery;
    try {
      localStorage.setItem('kidapp_children', JSON.stringify(state.children));
    } catch (e) {}
    const batteryEl = document.getElementById(`battery-${activeChild.id}`);
    if (batteryEl) {
      batteryEl.innerHTML = `<i data-lucide="battery"></i> ${battery}%`;
      lucide.createIcons();
    }
  }

  // Si el rebobinado de ruta está activo, NO actualizamos la posición visual del marcador para no interrumpir la reproducción
  if (isPlaybackActive) {
    return;
  }

  if (!map || !childMarker) return;

  childMarker.setLatLng(newPos);
  map.panTo(newPos);

  const name = activeChild ? activeChild.name : 'Hijo';
  const speedStr = speed || '0 km/h';
  const batteryStr = activeChild && activeChild.battery !== undefined ? ` 🔋 ${activeChild.battery}%` : '';
  childMarker.setPopupContent(`<b>${name}${batteryStr}</b><br>📍 Coord: ${numLat.toFixed(4)}, ${numLng.toFixed(4)}<br>⚡ Vel: ${speedStr} • 🕒 ${timestamp || 'En vivo'}`).openPopup();

  const speedEl = document.getElementById('current-speed');
  if (speedEl) speedEl.textContent = speedStr;

  // Actualizar batería en directo si viene en el ping de geolocalización
  if (battery !== undefined && activeChild) {
    activeChild.battery = battery;
    try {
      localStorage.setItem('kidapp_children', JSON.stringify(state.children));
    } catch (e) {}
    const batteryEl = document.getElementById(`battery-${activeChild.id}`);
    if (batteryEl) {
      batteryEl.innerHTML = `<i data-lucide="battery"></i> ${battery}%`;
      lucide.createIcons();
    }
  }

  addActivityFeedItem('gps', `📍 <strong>GPS EN VIVO ENVIADO POR MÓVIL:</strong> ${name} en [${numLat.toFixed(4)}, ${numLng.toFixed(4)}] (${speedStr})`, timestamp || 'Justo ahora');

  // EVALUAR CRUCE DE ZONAS SEGURAS EN TIEMPO REAL
  checkGeofences(numLat, numLng);
}

function requestHighAccuracyGps() {
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  const name = activeChild ? activeChild.name : 'tu hijo';
  const childId = activeChild ? activeChild.id : 'child_1';

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'REQUEST_HIGH_ACCURACY_GPS', childId: childId }));
    
    showToast(`📍 Solicitud de ubicación enviada a ${name}.`, 'success');

    addActivityFeedItem('gps', '📍 <strong>SOLICITUD DE GPS A DEMANDA:</strong> Petición de coordenadas exactas enviada al teléfono.', 'Justo ahora');
  } else {
    showToast('⚠️ No hay conexión en vivo con el servidor central.', 'error');
  }
}

function closeGpsRequestedModal() {
  const modal = document.getElementById('gps-requested-modal');
  if (modal) modal.classList.remove('active');
}

// LOUD SIGNAL TRIGGER (SEÑAL FUERTE)
function triggerLoudSignal() {
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  const childId = activeChild ? activeChild.id : 'child_1';

  try {
    fetch(`${BACKEND_URL}/api/signal/loud`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: childId })
    }).catch(err => console.error('Error enviando Señal Fuerte:', err));

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'TRIGGER_LOUD_SIGNAL', childId: childId }));
    }
  } catch (e) {
    console.error('Error disparando Señal Fuerte:', e);
  }

  addActivityFeedItem('lock', '🔔 <strong>SEÑAL FUERTE ACTIVADA EN LA NUBE:</strong> El móvil sonará a 100% de volumen.', 'Justo ahora');
}

// AMBIENT AUDIO LISTEN TRIGGER (ESCUCHAR ENTORNO)
function triggerAmbientAudio() {
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  const childId = activeChild ? activeChild.id : 'child_1';
  const name = activeChild ? activeChild.name : 'tu hijo';

  try {
    fetch(`${BACKEND_URL}/api/signal/ambient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: childId })
    }).catch(err => console.error('Error enviando solicitud Audio Entorno:', err));

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'TRIGGER_AMBIENT_AUDIO', childId: childId }));
    }
  } catch (e) {
    console.error('Error disparando Audio Entorno:', e);
  }

  addActivityFeedItem('ai', `🎙️ <strong>AUDIO DE ENTORNO EN PROCESO:</strong> Grabando 30s de audio ambiente desde el móvil de ${name}.`, 'Justo ahora');
}

// ── TOAST NOTIFICATION UTILITY ──────────────────────────────────────────────
function showToast(message, type = 'success', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// GAMIFIED CHORES PERSISTENCE & APPROVAL
function renderChoresList() {
  const container = document.getElementById('chores-container');
  if (!container) return;

  container.innerHTML = '';

  if (!state.chores || state.chores.length === 0) {
    container.innerHTML = `
      <p style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding:16px;">
        No hay misiones pendientes o completadas. Crea una nueva misión abajo para enviarla al móvil del hijo.
      </p>
    `;
    return;
  }

  state.chores.forEach(chore => {
    const choreCard = document.createElement('div');
    choreCard.className = 'chore-approval-item';
    choreCard.id = chore.id;
    
    if (chore.completed) {
      choreCard.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:var(--success-light); padding:12px 14px; border-radius:14px; border:1px solid var(--success); margin-bottom: 8px;';
      choreCard.innerHTML = `
        <div>
          <span class="chore-title" style="color:#047857; font-weight:700;">✓ Misión Validada: ${chore.name}</span>
          <span class="chore-reward" style="color:#047857; font-size:0.75rem; display:block;">+${chore.reward} minutos añadidos al saldo</span>
        </div>
        <span style="font-weight:800; color:#047857; font-size:0.85rem;">¡Completado!</span>
      `;
    } else {
      choreCard.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:var(--bg-subtle); padding:12px 14px; border-radius:14px; border:1px solid var(--border-light); margin-bottom: 8px;';
      choreCard.innerHTML = `
        <div class="chore-info">
          <span class="chore-title" style="font-weight:700; color:var(--text-dark); display:block;">📋 ${chore.name}</span>
          <span class="chore-reward" style="font-size:0.75rem; color:var(--primary);">+${chore.reward} minutos de tiempo extra</span>
        </div>
        <button class="btn-approve-chore" onclick="approveChore('${chore.id}')" style="background:var(--success); color:white; border:none; padding:8px 12px; border-radius:10px; font-weight:700; font-size:0.8rem; cursor:pointer; display:flex; align-items:center; gap:4px;">
          <i data-lucide="check" style="width:14px; height:14px;"></i> Validar (+${chore.reward}m)
        </button>
      `;
    }
    container.appendChild(choreCard);
  });
  
  lucide.createIcons();
}

function approveChore(choreId) {
  if (!state.chores) return;
  const chore = state.chores.find(c => c.id === choreId);
  if (!chore) return;

  chore.completed = true;
  localStorage.setItem('kidapp_chores', JSON.stringify(state.chores));

  state.remainingMinutes += chore.reward;
  localStorage.setItem('kidapp_remaining_minutes', state.remainingMinutes);

  const remTimeEl = document.getElementById('sim-rem-time');
  if (remTimeEl) remTimeEl.textContent = `${state.remainingMinutes} min`;
  const remBadgeEl = document.getElementById('rem-badge');
  if (remBadgeEl) remBadgeEl.textContent = `Restan ${state.remainingMinutes} min`;

  // 🔁 Sincronizar con el servidor central (nube)
  fetch(`${BACKEND_URL}/api/chores/${choreId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }).catch(e => console.error('Error aprobando tarea en servidor:', e));

  // 📡 Emitir por WebSocket para que todos los dispositivos lo vean al instante
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'CHORE_APPROVED',
      choreId: choreId,
      reward: chore.reward
    }));
    socket.send(JSON.stringify({
      type: 'ADD_SCREEN_TIME',
      childId: state.activeChild,
      minutes: chore.reward
    }));
  }

  renderChoresList();
  addActivityFeedItem('ai', `🏆 <strong>RECOMPENSA APROBADA:</strong> +${chore.reward}m por '${chore.name}'.`, 'Justo ahora');
}

function createChore() {
  const nameInput = document.getElementById('chore-name-input');
  const rewardSelect = document.getElementById('chore-reward-select');

  if (!nameInput || !nameInput.value.trim()) {
    showToast('⚠️ Por favor introduce la descripción de la tarea.', 'error');
    return;
  }

  const taskName = nameInput.value.trim();
  const rewardMins = parseInt(rewardSelect.value);
  const choreId = `chore_${Date.now()}`;

  if (!state.chores) state.chores = [];

  const newChore = {
    id: choreId,
    name: taskName,
    reward: rewardMins,
    completed: false,
    childId: state.activeChild
  };

  state.chores.push(newChore);
  localStorage.setItem('kidapp_chores', JSON.stringify(state.chores));
  renderChoresList();

  // 🔁 Sincronizar con el servidor central (nube)
  fetch(`${BACKEND_URL}/api/chores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ childId: state.activeChild, chore: newChore })
  }).catch(e => console.error('Error guardando tarea en servidor:', e));

  // 📡 Emitir por WebSocket para que el móvil la reciba al instante
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'CHORE_ADDED', childId: state.activeChild, chore: newChore }));
  }

  showToast(`✅ Misión "${taskName}" (+${rewardMins} min) asignada con éxito.`, 'success');
  nameInput.value = '';
  addActivityFeedItem('ai', `📋 <strong>NUEVA MISIÓN ASIGNADA:</strong> ${taskName} (+${rewardMins} min).`, 'Justo ahora');
}

// TAB NAVIGATION
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

  const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => btn.getAttribute('onclick')?.includes(tabId));
  if (activeBtn) activeBtn.classList.add('active');

  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');

  // Persistir pestaña activa actual
  localStorage.setItem('kidapp_active_tab', tabId);

  if (tabId === 'tab-gps' && map) {
    setTimeout(() => map.invalidateSize(), 200);
  }
}

// SWITCH ACTIVE CHILD (PESTAÑAS DE IZQUIERDA A DERECHA)
function switchChild(childId) {
  state.activeChild = childId;
  
  const activeChildObj = state.children.find(c => c.id === childId);
  const childName = activeChildObj ? activeChildObj.name : childId;
  
  renderActiveChildHeader();
  
  addActivityFeedItem('ai', `👦 <strong>PERFIL ACTIVO:</strong> Visualizando datos de <strong>${childName}</strong>.`, 'Justo ahora');

  // Renderizar límites de aplicaciones del hijo activo
  renderAppLimitsList();

  // Actualizar título de la sección de misiones domésticas
  const assignTitle = document.getElementById('chore-assign-title');
  if (assignTitle) {
    assignTitle.innerHTML = `<i data-lucide="plus-circle"></i> Asignar Nueva Misión a ${childName}`;
    lucide.createIcons();
  }

  // Detener rebobinado y restaurar a tiempo real al cambiar de hijo
  if (typeof stopPlaybackModeAndRestoreRealTime === 'function') {
    try {
      stopPlaybackModeAndRestoreRealTime();
      const routePoints = getRouteHistoryForActiveChild();
      const slider = document.getElementById('playback-slider');
      if (slider) {
        slider.max = routePoints.length - 1;
        slider.value = 0;
      }
      const statusText = document.getElementById('playback-status-text');
      if (statusText) {
        statusText.textContent = `Listo para rebobinar ruta (${routePoints.length} puntos)`;
      }
    } catch (e) {
      console.error('Error al resetear rebobinado al cambiar de hijo:', e);
    }
  }

  // Actualizar checkbox de filtro de contactos
  const chkContacts = document.getElementById('chk-contacts-only');
  if (chkContacts) {
    const activeChild = state.children.find(c => c.id === childId);
    chkContacts.checked = activeChild ? !!activeChild.contactsOnlyFilter : false;
  }

  // Sincronizar el Filtro de Contenido Web del hijo
  const activeChild = state.children.find(c => c.id === childId);
  if (activeChild) {
    if (activeChild.webFilterEnabled === undefined) {
      activeChild.webFilterEnabled = false;
    }
    if (!activeChild.webFilterCategories) {
      activeChild.webFilterCategories = {
        adult: false,
        gambling: false,
        violence: false,
        social: false,
        games: false
      };
    }

    // Si el filtro maestro está activo, forzar todas las categorías a true (bloqueadas)
    if (activeChild.webFilterEnabled) {
      for (const key of ['adult', 'gambling', 'violence', 'social', 'games']) {
        activeChild.webFilterCategories[key] = true;
      }
    }

    // Actualizar switch maestro
    const chkWebFilter = document.getElementById('chk-web-filter');
    if (chkWebFilter) {
      chkWebFilter.checked = !!activeChild.webFilterEnabled;
    }

    // Actualizar visualmente la opacidad del bloque
    const categoriesList = document.getElementById('web-filter-categories-list');
    if (categoriesList) {
      if (activeChild.webFilterEnabled) {
        categoriesList.style.opacity = '0.7';
        categoriesList.style.pointerEvents = 'none';
      } else {
        categoriesList.style.opacity = '1';
        categoriesList.style.pointerEvents = 'auto';
      }
    }

    // Actualizar cada checkbox de categoría
    document.querySelectorAll('.chk-web-category').forEach(chk => {
      const cat = chk.getAttribute('data-category');
      chk.checked = activeChild.webFilterCategories ? !!activeChild.webFilterCategories[cat] : false;
    });
  }
}

// TOGGLE GLOBAL LOCK (PAUSAR INTERNET)
function toggleGlobalLock() {
  state.isGlobalLocked = !state.isGlobalLocked;
  handleRemoteLockUpdate(state.isGlobalLocked, 'Pausa familiar activada desde la PWA del padre');

  const activeChildObj = state.children.find(c => c.id === state.activeChild) || state.children[0];
  const targetChildId = activeChildObj ? activeChildObj.id : 'child_1';

  if (activeChildObj) {
    activeChildObj.isLocked = state.isGlobalLocked;
    try {
      localStorage.setItem('kidapp_children', JSON.stringify(state.children));
    } catch (e) {}
  }

  // ALSO SEND EVENT TO RENDER CLOUD BACKEND VIA HTTP/WS
  try {
    fetch(`${BACKEND_URL}/api/lock/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: targetChildId, isLocked: state.isGlobalLocked })
    }).catch(err => console.error('Error enviando al backend en la nube:', err));
  } catch (e) {
    console.error('Error disparando API:', e);
  }
}

function handleRemoteLockUpdate(isLocked, reason) {
  state.isGlobalLocked = isLocked;
  const pauseBtn = document.getElementById('btn-pause-internet');
  const btnText = document.getElementById('pause-btn-text');
  const unlockedScreen = document.getElementById('screen-unlocked');
  const lockedScreen = document.getElementById('screen-locked');
  const lockReasonText = document.getElementById('lock-reason-text');

  if (state.isGlobalLocked) {
    pauseBtn.classList.add('unpause');
    if (btnText) btnText.textContent = "Reanudar";
    if (unlockedScreen) unlockedScreen.classList.remove('active');
    if (lockedScreen) lockedScreen.classList.add('active');
    if (lockReasonText) lockReasonText.textContent = reason || "Pausa familiar activada desde la PWA del padre.";

    addActivityFeedItem('lock', '<strong>PAUSA FAMILIAR ACTIVADA EN LA NUBE:</strong> Dispositivo bloqueado.', 'Ahora');
  } else {
    pauseBtn.classList.remove('unpause');
    if (btnText) btnText.textContent = "Pausar";
    if (lockedScreen) lockedScreen.classList.remove('active');
    if (unlockedScreen) unlockedScreen.classList.add('active');

    addActivityFeedItem('lock', 'Pausa familiar desactivada. Acceso restablecido.', 'Ahora');
  }
}

// FORMAT TIME FOR APP USAGE DISPLAY
function formatUsageTime(seconds) {
  if (!seconds || seconds <= 0) return '0m usado hoy';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m usado hoy`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m usado hoy`;
}

// RENDER APP CONTROL LIST DYNAMICALLY
function renderAppLimitsList() {
  const container = document.querySelector('.apps-control-list');
  if (!container) return;

  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  if (!activeChild) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:10px 0;">Vincula un dispositivo para gestionar sus límites.</p>';
    return;
  }

  if (!activeChild.appLimits) activeChild.appLimits = {};
  if (!activeChild.appUsage) activeChild.appUsage = {};

  let apps = [];
  if (activeChild.installedApps && activeChild.installedApps.length > 0) {
    apps = activeChild.installedApps.map(app => {
      let icon = '📱';
      const nameLower = app.appName.toLowerCase();
      const pkgLower = app.packageName.toLowerCase();
      if (nameLower.includes("roblox")) icon = '🎮';
      else if (nameLower.includes("tiktok")) icon = '🎵';
      else if (nameLower.includes("youtube")) icon = '📺';
      else if (nameLower.includes("whatsapp")) icon = '💬';
      else if (nameLower.includes("instagram")) icon = '📸';
      else if (nameLower.includes("brawl") || nameLower.includes("stars")) icon = '⚔️';
      else if (nameLower.includes("chrome") || nameLower.includes("browser")) icon = '🌐';
      else if (nameLower.includes("game") || nameLower.includes("play") || pkgLower.includes("game")) icon = '🎮';
      else if (nameLower.includes("music") || nameLower.includes("spotify")) icon = '🎧';
      else if (nameLower.includes("camera") || nameLower.includes("foto")) icon = '📷';
      else if (nameLower.includes("facebook") || nameLower.includes("fb")) icon = '👥';
      else if (nameLower.includes("twitter") || nameLower.includes("x app")) icon = '🐦';
      else if (nameLower.includes("snapchat")) icon = '👻';
      else if (nameLower.includes("telegram")) icon = '✈️';
      else if (nameLower.includes("netflix")) icon = '🎬';
      else if (nameLower.includes("minecraft")) icon = '🧱';
      return { name: app.appName, packageName: app.packageName, icon, iconBase64: app.iconBase64 || null };
    });
    // Bloqueadas primero, luego con límite, luego permitidas — dentro de cada grupo, orden alfabético
    apps.sort((a, b) => {
      const la = activeChild.appLimits[a.packageName] || 'allowed';
      const lb = activeChild.appLimits[b.packageName] || 'allowed';
      const rank = v => v === 'blocked' ? 0 : v !== 'allowed' ? 1 : 2;
      if (rank(la) !== rank(lb)) return rank(la) - rank(lb);
      return a.name.localeCompare(b.name);
    });
  } else {
    apps = [
      { name: 'Roblox', packageName: 'com.roblox.client', icon: '🎮' },
      { name: 'TikTok', packageName: 'com.zhiliaoapp.musically', icon: '🎵' },
      { name: 'YouTube', packageName: 'com.google.android.youtube', icon: '📺' },
      { name: 'WhatsApp', packageName: 'com.whatsapp', icon: '💬' },
      { name: 'Instagram', packageName: 'com.instagram.android', icon: '📸' },
      { name: 'Brawl Stars', packageName: 'com.supercell.brawlstars', icon: '⚔️' }
    ];
  }

  let html = '';
  apps.forEach(app => {
    const limit = activeChild.appLimits[app.packageName] || 'allowed';
    const usageSec = activeChild.appUsage[app.packageName] || 0;
    const usageStr = formatUsageTime(usageSec);
    const isBlocked = limit === 'blocked';
    const lockIcon = isBlocked
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;

    html += `
      <div class="app-control-row" style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #f1f5f9;">
        <div class="app-details" style="display:flex; align-items:center; gap:12px;">
          <span class="app-icon" style="font-size:1.8rem; background:rgba(0,0,0,0.05); min-width:44px; width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; overflow:hidden;">
            ${app.iconBase64
              ? `<img src="data:image/png;base64,${app.iconBase64}" alt="" style="width:36px;height:36px;object-fit:contain;border-radius:8px;" onerror="this.parentElement.textContent='${app.icon}'">`
              : app.icon
            }
          </span>
          <div>
            <span class="title" style="font-weight:700; color:var(--text-dark); display:block;">${app.name}</span>
            <span class="sub" style="font-size:0.75rem; color:var(--text-muted);">${usageStr}</span>
          </div>
        </div>
        <div class="app-actions" style="display:flex; align-items:center; gap:10px;">
          <select class="select-limit" onchange="updateAppLimit('${app.packageName}', this.value)" style="padding:6px 12px; border-radius:10px; border:1.5px solid #e2e8f0; background:#f8fafc; font-family:'Outfit',sans-serif; font-size:0.8rem; font-weight:600; color:var(--text-dark); cursor:pointer;">
            <option value="allowed" ${limit === 'allowed' ? 'selected' : ''}>Sin Límite</option>
            <option value="1m" ${limit === '1m' ? 'selected' : ''}>Max 1 min (Test)</option>
            <option value="3m" ${limit === '3m' ? 'selected' : ''}>Max 3 min (Test)</option>
            <option value="5m" ${limit === '5m' ? 'selected' : ''}>Max 5 min (Test)</option>
            <option value="15m" ${limit === '15m' ? 'selected' : ''}>Max 15m</option>
            <option value="30m" ${limit === '30m' ? 'selected' : ''}>Max 30m</option>
            <option value="45m" ${limit === '45m' ? 'selected' : ''}>Max 45m</option>
            <option value="1h" ${limit === '1h' ? 'selected' : ''}>Max 1h</option>
            <option value="1h30m" ${limit === '1h30m' ? 'selected' : ''}>Max 1.5h</option>
            <option value="2h" ${limit === '2h' ? 'selected' : ''}>Max 2h</option>
            <option value="3h" ${limit === '3h' ? 'selected' : ''}>Max 3h</option>
            <option value="blocked" ${limit === 'blocked' ? 'selected' : ''}>Bloqueada</option>
          </select>
          <button class="btn-icon-lock" onclick="toggleSingleAppLock('${app.packageName}', this)" style="border:none; border-radius:10px; width:34px; height:34px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s ease; background:${isBlocked ? '#fef2f2' : 'var(--success-light)'}; color:${isBlocked ? 'var(--danger)' : 'var(--success)'};">
            ${lockIcon}
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  lucide.createIcons();
}

// SINGLE APP LOCK TOGGLE
function toggleSingleAppLock(packageName, btnElement) {
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  if (!activeChild) return;

  if (!activeChild.appLimits) activeChild.appLimits = {};
  
  let appName = packageName;
  if (activeChild.installedApps) {
    const found = activeChild.installedApps.find(a => a.packageName === packageName);
    if (found) appName = found.appName;
  } else {
    const defaults = {
      'com.roblox.client': 'Roblox',
      'com.zhiliaoapp.musically': 'TikTok',
      'com.google.android.youtube': 'YouTube',
      'com.whatsapp': 'WhatsApp',
      'com.instagram.android': 'Instagram',
      'com.supercell.brawlstars': 'Brawl Stars'
    };
    appName = defaults[packageName] || packageName;
  }

  const current = activeChild.appLimits[packageName] || 'allowed';
  if (current === 'blocked') {
    activeChild.appLimits[packageName] = 'allowed';
    addActivityFeedItem('lock', `Desbloqueada app: <strong>${appName}</strong> para ${activeChild.name}`, 'Ahora');
  } else {
    activeChild.appLimits[packageName] = 'blocked';
    addActivityFeedItem('lock', `Bloqueada app: <strong>${appName}</strong> para ${activeChild.name}`, 'Ahora');
  }

  try {
    localStorage.setItem('kidapp_children', JSON.stringify(state.children));
  } catch (e) {}

  renderAppLimitsList();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'APP_LIMITS_UPDATE',
      childId: activeChild.id,
      appLimits: activeChild.appLimits
    }));
  }
}

// UPDATE APP TIME LIMIT
function updateAppLimit(packageName, value) {
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  if (!activeChild) return;

  if (!activeChild.appLimits) activeChild.appLimits = {};
  activeChild.appLimits[packageName] = value;
  
  let appName = packageName;
  if (activeChild.installedApps) {
    const found = activeChild.installedApps.find(a => a.packageName === packageName);
    if (found) appName = found.appName;
  } else {
    const defaults = {
      'com.roblox.client': 'Roblox',
      'com.zhiliaoapp.musically': 'TikTok',
      'com.google.android.youtube': 'YouTube',
      'com.whatsapp': 'WhatsApp',
      'com.instagram.android': 'Instagram',
      'com.supercell.brawlstars': 'Brawl Stars'
    };
    appName = defaults[packageName] || packageName;
  }

  const formattedVal = value === 'allowed' ? 'Sin Límite' : value === 'blocked' ? 'Bloqueada' : `Max ${value}`;
  addActivityFeedItem('ai', `Límite de <strong>${appName}</strong> para ${activeChild.name}: ${formattedVal}`, 'Ahora');

  try {
    localStorage.setItem('kidapp_children', JSON.stringify(state.children));
  } catch (e) {}

  renderAppLimitsList();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'APP_LIMITS_UPDATE',
      childId: activeChild.id,
      appLimits: activeChild.appLimits
    }));
  }
}

// TOGGLE CONTACTS-ONLY CALL FILTER
function toggleContactsOnlyFilter(isChecked) {
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  if (!activeChild) return;

  activeChild.contactsOnlyFilter = isChecked;

  const statusStr = isChecked ? 'ACTIVADO' : 'DESACTIVADO';
  addActivityFeedItem('shield', `Filtro de llamadas fuera de la agenda para ${activeChild.name}: <strong>${statusStr}</strong>`, 'Ahora');

  try {
    localStorage.setItem('kidapp_children', JSON.stringify(state.children));
  } catch (e) {}

  showToast(`Filtro de llamadas ${isChecked ? 'activado' : 'desactivado'} para ${activeChild.name}`, 'success');

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'CONTACTS_ONLY_FILTER_UPDATE',
      childId: activeChild.id,
      contactsOnlyFilter: isChecked
    }));
  }
}

// TOGGLE WEB FILTER MASTER SWITCH
function toggleWebFilter(isChecked) {
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  if (!activeChild) return;

  activeChild.webFilterEnabled = isChecked;

  // Si se activa el general, todos los filtros de categorías individuales quedan activos (bloqueados)
  if (isChecked) {
    if (!activeChild.webFilterCategories) {
      activeChild.webFilterCategories = {};
    }
    for (const key of ['adult', 'gambling', 'violence', 'social', 'games']) {
      activeChild.webFilterCategories[key] = true;
    }
  }

  // Sincronizar UI de la lista de categorías (bloquearlas si el general está encendido, activarlas si está apagado)
  const categoriesList = document.getElementById('web-filter-categories-list');
  if (categoriesList) {
    if (isChecked) {
      categoriesList.style.opacity = '0.7';
      categoriesList.style.pointerEvents = 'none';
    } else {
      categoriesList.style.opacity = '1';
      categoriesList.style.pointerEvents = 'auto';
    }
  }

  // Actualizar visualmente cada checkbox de categoría en el DOM
  document.querySelectorAll('.chk-web-category').forEach(chk => {
    const cat = chk.getAttribute('data-category');
    chk.checked = activeChild.webFilterCategories ? !!activeChild.webFilterCategories[cat] : false;
  });

  const statusStr = isChecked ? 'ACTIVADO (Todo Bloqueado)' : 'DESACTIVADO (Filtros Individuales)';
  addActivityFeedItem('shield', `Filtro de contenido web maestro para ${activeChild.name}: <strong>${statusStr}</strong>`, 'Ahora');

  try {
    localStorage.setItem('kidapp_children', JSON.stringify(state.children));
  } catch (e) {}

  showToast(`Filtro web general ${isChecked ? 'activado' : 'desactivado'} para ${activeChild.name}`, 'success');

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'WEB_FILTER_UPDATE',
      childId: activeChild.id,
      enabled: isChecked,
      categories: activeChild.webFilterCategories || {}
    }));
  }
}

// TOGGLE WEB FILTER CATEGORY SWITCH
function toggleWebCategory(category, isBlocked) {
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  if (!activeChild) return;

  if (!activeChild.webFilterCategories) {
    activeChild.webFilterCategories = {
      adult: false,
      gambling: false,
      violence: false,
      social: false,
      games: false
    };
  }

  activeChild.webFilterCategories[category] = isBlocked;

  const categoryNames = {
    adult: 'Contenido Adulto 🔞',
    gambling: 'Apuestas y Juego 🎰',
    violence: 'Violencia y Armas ⚠️',
    social: 'Redes Sociales (Web) 💬',
    games: 'Videojuegos Web 🎮'
  };

  const catName = categoryNames[category] || category;
  const statusStr = isBlocked ? 'BLOQUEADA' : 'PERMITIDA';
  addActivityFeedItem('shield', `Categoría <strong>${catName}</strong> para ${activeChild.name} ahora está <strong>${statusStr}</strong>`, 'Ahora');

  try {
    localStorage.setItem('kidapp_children', JSON.stringify(state.children));
  } catch (e) {}

  showToast(`Categoría ${catName} ${isBlocked ? 'bloqueada' : 'permitida'}`, 'success');

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'WEB_FILTER_CATEGORY_UPDATE',
      childId: activeChild.id,
      category: category,
      blocked: isBlocked
    }));
  }
}

// RESOLVE AI MEDIATOR REQUEST
function resolveAiRequest(action) {
  const reqBox = document.getElementById('ai-request-box');
  const badgeCount = document.getElementById('ai-pending-count');

  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  const name = activeChild ? activeChild.name : 'tu hijo';

  if (action === 'approve') {
    state.remainingMinutes += 15;
    const simRemTimeEl = document.getElementById('sim-rem-time');
    if (simRemTimeEl) simRemTimeEl.textContent = `${state.remainingMinutes} min`;
    const remBadgeEl = document.getElementById('rem-badge');
    if (remBadgeEl) remBadgeEl.textContent = `Restan ${state.remainingMinutes} min`;

    reqBox.innerHTML = `
      <div class="req-header">
        <span class="child-tag" style="color: var(--success);">✓ Solicitud Aprobada (+15m)</span>
        <span class="timestamp">Hace unos segundos</span>
      </div>
      <p style="font-size:0.85rem; color: var(--text-muted);">Has concedido 15 minutos adicionales a ${name}. La IA ha actualizado la pantalla de su teléfono.</p>
    `;

    addActivityFeedItem('ai', `<strong>IA Mediadora:</strong> Aprobados 15 min extra a ${name} para su trabajo escolar.`, 'Ahora');
  } else {
    reqBox.innerHTML = `
      <div class="req-header">
        <span class="child-tag" style="color: var(--danger);">✕ Solicitud Denegada</span>
        <span class="timestamp">Hace unos segundos</span>
      </div>
      <p style="font-size:0.85rem; color: var(--text-muted);">La IA ha enviado un mensaje explicativo y amable al teléfono de ${name} sobre la denegación.</p>
    `;

    addActivityFeedItem('ai', 'IA Mediadora: Solicitud de tiempo extra denegada educadamente.', 'Ahora');
  }

  if (badgeCount) badgeCount.textContent = "0";
}

// SIMULATE CHILD ASKING FOR EXTRA TIME
function simAskExtraTime() {
  switchTab('tab-ai');
  const reqContainer = document.querySelector('.ai-requests-container');
  if (!reqContainer) return;

  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  const name = activeChild ? activeChild.name : 'Hijo';

  const newBox = document.createElement('div');
  newBox.className = 'request-card pending';
  newBox.id = 'ai-request-box-new';
  newBox.innerHTML = `
    <div class="req-header">
      <span class="child-tag">👦 ${name} solicita +15 minutos</span>
      <span class="timestamp">Justo ahora</span>
    </div>
    <div class="req-body">
      <p class="req-reason"><strong>Motivo indicado por ${name}:</strong> <em>"Por favor dame 15 minutos más para terminar de chatear con los compañeros sobre la tarea."</em></p>
      <div class="ai-eval">
        <i data-lucide="bot"></i>
        <span><strong>Recomendación de la IA:</strong> Solicitud directa recibida desde el simulador. Se sugiere evaluar el progreso del día.</span>
      </div>
    </div>
    <div class="req-actions">
      <button class="btn-approve" onclick="resolveAiRequest('approve')">
        <i data-lucide="check-circle"></i> Aprobar 15m
      </button>
      <button class="btn-deny" onclick="resolveAiRequest('deny')">
        <i data-lucide="x-circle"></i> Denegar
      </button>
    </div>
  `;
  reqContainer.prepend(newBox);
  lucide.createIcons();

  const badgeCount = document.getElementById('ai-pending-count');
  if (badgeCount) badgeCount.textContent = "1";
}

// SOS EMERGENCY TRIGGER FROM CHILD
function triggerSosEmergency() {
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  const name = activeChild ? activeChild.name : 'tu hijo';
  const battery = activeChild && activeChild.battery ? `${activeChild.battery}%` : '85%';

  const topBar = document.querySelector('.top-bar');
  const alertBanner = document.createElement('div');
  alertBanner.style.cssText = `
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: white;
    padding: 14px 20px;
    border-radius: 14px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 10px 30px rgba(239,68,68,0.4);
    animation: pulse 1.5s infinite;
    margin-bottom: 16px;
  `;
  alertBanner.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <span style="font-size:1.5rem;">🚨</span>
      <div>
        <span>¡ALERTA SOS RECIBIDA DE ${name.toUpperCase()}!</span>
        <div style="font-size:0.75rem; font-weight:400;">Ubicación enviada • Audio de Entorno grabado • Batería ${battery}</div>
      </div>
    </div>
    <button onclick="this.parentElement.remove()" style="background:white; color:#dc2626; border:none; padding:6px 14px; border-radius:8px; font-weight:700; cursor:pointer;">Atendido</button>
  `;

  document.querySelector('.parent-dashboard').prepend(alertBanner);
  addActivityFeedItem('lock', `🚨 <strong>ALERTA SOS DE EMERGENCIA ACTIVADA POR ${name.toUpperCase()} (Con Audio de Entorno)</strong>`, 'Justo ahora');
}

// OPEN SIM APP
function openSimApp(appName) {
  if (state.isGlobalLocked) {
    alert(`Móvil bloqueado: No se puede abrir ${appName}`);
    return;
  }
  if (state.appLimits[appName] === 'blocked') {
    alert(`La app ${appName} está bloqueada por tus padres.`);
    return;
  }
  alert(`Abriendo ${appName} en el simulador del hijo...`);
}

// REPRODUCTOR DE AUDIO DE ENTORNO EN LA PWA DEL PADRE
function handleNewAmbientAudio(audioUrl, timestamp) {
  const fullAudioUrl = audioUrl.startsWith('http') ? audioUrl : `${BACKEND_URL}${audioUrl}`;
  
  const feed = document.getElementById('activity-feed');
  if (feed) {
    const li = document.createElement('li');
    li.className = 'feed-item';
    li.style.background = 'var(--accent-ai-light)';
    li.style.borderColor = 'rgba(2, 132, 199, 0.3)';
    li.innerHTML = `
      <span class="feed-icon ai"><i data-lucide="mic"></i></span>
      <div class="feed-details" style="width: 100%;">
        <span class="title">🎙️ <strong>AUDIO DE ENTORNO RECIBIDO (30s)</strong></span>
        <audio controls style="width: 100%; height: 36px; margin-top: 6px; border-radius: 8px;" src="${fullAudioUrl}"></audio>
        <span class="time">${timestamp || 'Justo ahora'}</span>
      </div>
    `;
    feed.prepend(li);
    lucide.createIcons();
  }

  alert('🎙️ ¡NUEVO AUDIO DE ENTORNO DISPONIBLE!\n\nSe ha recibido la grabación de 30 segundos del móvil del hijo. Puedes escucharla ahora mismo en tu panel de actividad.');
}

// HELPER TO ADD FEED ITEM
function addActivityFeedItem(type, titleHtml, timeStr) {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;

  const li = document.createElement('li');
  li.className = 'feed-item';
  li.innerHTML = `
    <span class="feed-icon ${type}"><i data-lucide="${type === 'gps' ? 'map-pin' : type === 'lock' ? 'shield-alert' : 'sparkles'}"></i></span>
    <div class="feed-details">
      <span class="title">${titleHtml}</span>
      <span class="time">${timeStr}</span>
    </div>
  `;
  feed.prepend(li);
  lucide.createIcons();
}

// GENERADOR Y MANEJADOR DE CÓDIGO QR DE VINCULACIÓN EN 60 SEGUNDOS
function fetchNewQrCode() {
  fetch(`${BACKEND_URL}/api/devices/qr-generate`)
    .then(res => res.json())
    .then(data => {
      if (data.pairingCode && data.qrUrl) {
        const qrImg = document.getElementById('qr-code-img');
        const qrText = document.getElementById('qr-code-text');
        if (qrImg) qrImg.src = data.qrUrl;
        if (qrText) qrText.innerHTML = `Código único: <strong>${data.pairingCode}</strong>`;
      }
    })
    .catch(err => console.error('Error generando QR dinámico:', err));
}

function handleDevicePairedEvent(child) {
  // Buscar el hijo activo en el estado PWA
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  
  const childName = activeChild ? activeChild.name : (child ? child.name : 'tu hijo');
  const childDevice = child ? child.device : 'Teléfono Android';
  const childBattery = (child && child.battery) ? child.battery : 85;

  // Cerrar el modal del código QR emergente
  closeQrPairingModal();

  // Actualizar datos del hijo en el estado y guardar en LocalStorage
  if (activeChild) {
    activeChild.device = childDevice;
    activeChild.battery = childBattery;
    activeChild.status = 'online';

    try {
      localStorage.setItem('kidapp_children', JSON.stringify(state.children));
    } catch (e) {
      console.error('Error guardando telemetría en LocalStorage:', e);
    }

    // Actualizar visualmente la tarjeta de la pestaña de este hijo
    const statusTag = document.getElementById(`status-tag-${activeChild.id}`);
    if (statusTag) {
      statusTag.textContent = `● En línea`;
      statusTag.style.cssText = 'cursor: default; background: rgba(16, 185, 129, 0.1); color: #10b981; font-weight: 700;';
      statusTag.onclick = null; // Quita el onclick de reescanear ya que está emparejado
    }

    const batteryEl = document.getElementById(`battery-${activeChild.id}`);
    if (batteryEl) {
      batteryEl.innerHTML = `<i data-lucide="battery"></i> ${childBattery}%`;
    }
    lucide.createIcons();
  }

  showFloatingPushNotification('inside', '🎉 DISPOSITIVO VINCULADO', `Teléfono ${childDevice} de ${childName} conectado con éxito.`);
  alert(`🎉 ¡VINCULACIÓN COMPLETADA EN 15s!\n\nEl teléfono ${childDevice} de ${childName} ha sido vinculado y ya está 100% conectado en la nube.`);
  addActivityFeedItem('gps', `🎉 <strong>VINCULACIÓN COMPLETADA:</strong> Teléfono ${childDevice} de ${childName} emparejado en vivo.`, 'Justo ahora');
}

// CONTROLADOR DE ALTA DE NUEVO HIJO (FOTO, DISPOSITIVO Y BATERÍA)
let currentChildPhotoUrl = null;

function openAddChildModal() {
  const modal = document.getElementById('add-child-modal');
  if (modal) modal.classList.add('active');
  lucide.createIcons();
}

function closeAddChildModal() {
  const modal = document.getElementById('add-child-modal');
  if (modal) modal.classList.remove('active');
  currentChildPhotoUrl = null;
}

function selectAvatarEmoji(emojiStr) {
  const preview = document.getElementById('photo-preview-box');
  if (preview) {
    preview.innerHTML = emojiStr;
    currentChildPhotoUrl = null;
  }
}

function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    currentChildPhotoUrl = e.target.result;
    const preview = document.getElementById('photo-preview-box');
    if (preview) {
      preview.innerHTML = `<img src="${currentChildPhotoUrl}" style="width:100%; height:100%; object-fit:cover;">`;
    }
  };
  reader.readAsDataURL(file);
}

function openQrPairingModal(childName) {
  const modal = document.getElementById('qr-pairing-modal');
  const title = document.getElementById('qr-modal-title');
  const sub = document.getElementById('qr-modal-sub');

  if (title) title.textContent = `📸 Vincular Teléfono de ${childName || 'tu Hijo'}`;
  if (sub) sub.textContent = `Abre KidApp Agent en el móvil de ${childName || 'tu hijo'} y apunta la cámara a esta pantalla.`;

  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
  }

  fetch(`${BACKEND_URL}/api/devices/qr-generate?childId=${state.activeChild || ''}`)
    .then(res => res.json())
    .then(data => {
      if (data.pairingCode && data.qrUrl) {
        const qrImg = document.getElementById('modal-qr-img');
        const qrCodeText = document.getElementById('modal-qr-code');
        if (qrImg) qrImg.src = data.qrUrl;
        if (qrCodeText) qrCodeText.textContent = data.pairingCode;
      }
    })
    .catch(err => console.error('Error generando QR dinámico:', err));

  lucide.createIcons();
}

function closeQrPairingModal() {
  const modal = document.getElementById('qr-pairing-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

function saveNewChildProfile(event) {
  event.preventDefault();

  const nameInput = document.getElementById('child-name-input');
  const name = nameInput ? nameInput.value.trim() : 'Hijo';
  const emoji = document.getElementById('child-emoji-select').value || '👦';

  const phoneInput = document.getElementById('child-phone-input');
  const phone = phoneInput ? phoneInput.value.trim() : '';

  const avatarContent = currentChildPhotoUrl
    ? `<img src="${currentChildPhotoUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`
    : emoji;

  const newChildId = `child_${Date.now()}`;
  const newChild = {
    id: newChildId,
    name: name,
    phone: phone,
    device: 'Emparejando por QR...',
    battery: '--',
    avatar: avatarContent,
    status: 'offline',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid', // Huso horario detectado automáticamente
    webFilterEnabled: false,
    webFilterCategories: {
      adult: false,
      gambling: false,
      violence: false,
      social: false,
      games: false
    },
    appLimits: {
      'com.roblox.client': '1h30m',
      'com.zhiliaoapp.musically': '45m',
      'com.google.android.youtube': '1h'
    },
    appUsage: {
      'com.roblox.client': 0,
      'com.zhiliaoapp.musically': 0,
      'com.google.android.youtube': 0
    }
  };

  // Inicializar array de hijos si no existe
  if (!state.children) state.children = [];

  // Añadir a estado y activar el nuevo hijo
  state.children.push(newChild);
  state.activeChild = newChildId;

  // Persistir en LocalStorage
  try {
    localStorage.setItem('kidapp_children', JSON.stringify(state.children));
  } catch (e) {
    console.error('Error guardando hijos en LocalStorage:', e);
  }

  // PERSISTIR EN EL SERVIDOR CENTRAL DE LA NUBE (Render)
  try {
    fetch(`${BACKEND_URL}/api/children`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ child: newChild })
    }).catch(err => console.error('Error sincronizando hijo con el servidor central:', err));
  } catch (e) {
    console.error('Error disparando fetch central:', e);
  }

  closeAddChildModal();
  selectChild(newChildId);

  // ¡SALTO INSTANTÁNEO AL MODAL DE CÓDIGO QR!
  openQrPairingModal(name);
  addActivityFeedItem('gps', `👦 <strong>NUEVO PERFIL CREADO:</strong> ${name}. Esperando vinculación por QR.`, 'Justo ahora');
}

function renderChildrenBar(newChild) {
  renderChildrenSelector();
}

// DESVINCULAR DISPOSITIVO REMOTAMENTE EN TIEMPO REAL
function unpairDevice(childId, childName, deviceModel) {
  const modal = document.getElementById('unpair-confirm-modal');
  const descEl = document.getElementById('unpair-modal-desc');
  const confirmBtn = document.getElementById('btn-confirm-unpair');
  
  if (!modal || !descEl || !confirmBtn) {
    // Fallback legado si no se encuentran los elementos
    const legacyConfirm = confirm(`⚠️ ¿Deseas desvincular el dispositivo ${deviceModel} de ${childName}?\n\nEl teléfono dejará de transmitir su GPS, audio y datos al panel de los padres.`);
    if (legacyConfirm) executeUnpairDeviceAction(childId, childName, deviceModel);
    return;
  }

  // Personalizar la descripción en el modal con HTML
  descEl.innerHTML = `¿Estás seguro de que deseas desvincular el dispositivo <strong>${deviceModel}</strong> de <strong>${childName}</strong>?<br><br>El teléfono dejará de transmitir su GPS, batería y datos en tiempo real al panel de los padres.`;
  
  // Asignar el comportamiento al hacer clic en el botón de confirmar del modal
  confirmBtn.onclick = function() {
    executeUnpairDeviceAction(childId, childName, deviceModel);
    closeUnpairConfirmModal();
  };

  // Mostrar el modal
  modal.classList.add('active');
  modal.style.display = 'flex';
  lucide.createIcons();
}

function closeUnpairConfirmModal() {
  const modal = document.getElementById('unpair-confirm-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

function executeUnpairDeviceAction(childId, childName, deviceModel) {
  // 1. Notificar por WebSocket al backend para romper la conexión con el móvil y limpiar datos
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'UNPAIR_DEVICE',
      childId: childId
    }));
  }

  // 2. Eliminar de estado y persistir en LocalStorage
  if (state.children) {
    state.children = state.children.filter(c => c.id !== childId);
    try {
      localStorage.setItem('kidapp_children', JSON.stringify(state.children));
    } catch (e) {
      console.error('Error actualizando LocalStorage tras desvincular:', e);
    }
  }

  const isLastChild = !state.children || state.children.length === 0;

  if (isLastChild) {
    localStorage.removeItem('kidapp_zones');
    localStorage.removeItem('kidapp_chores');
    localStorage.removeItem('kidapp_routines');
    localStorage.removeItem('kidapp_remaining_minutes');
    localStorage.removeItem('kidapp_active_child');

    state.savedZones = [];
    state.chores = [];
    state.routines = [];
    state.remainingMinutes = 0;
    state.activeChild = null;
  }

  // 2b. Eliminar del servidor central de la nube (Render) y recargar si es el último
  try {
    fetch(`${BACKEND_URL}/api/children/${childId}`, {
      method: 'DELETE'
    })
    .then(res => res.json())
    .then(data => {
      if (isLastChild) {
        window.location.reload();
      }
    })
    .catch(err => {
      console.error('Error eliminando hijo del servidor central:', err);
      if (isLastChild) {
        window.location.reload();
      }
    });
  } catch (e) {
    console.error('Error disparando delete central:', e);
    if (isLastChild) {
      window.location.reload();
    }
  }

  // 3. Renderizar el selector de nuevo para que desaparezca la tarjeta
  renderChildrenSelector();

  // 4. Seleccionar otro hijo activo si queda alguno o volver al inicio
  if (state.activeChild === childId) {
    if (state.children && state.children.length > 0) {
      selectChild(state.children[0].id);
    } else {
      goHome();
    }
  }

  showFloatingPushNotification('outside', '🗑️ DISPOSITIVO DESVINCULADO', `El teléfono ${deviceModel} de ${childName} ha sido desconectado.`);
  addActivityFeedItem('gps', `🗑️ <strong>DISPOSITIVO DESVINCULADO:</strong> ${deviceModel} de ${childName} eliminado del panel.`, 'Justo ahora');
}

// ==========================================
// SISTEMA DE REBOBINADO HISTÓRICO DE RUTA (PLAYBACK)
// ==========================================
let playbackPolyline = null;
let playbackInterval = null;
let currentPlaybackIndex = 0;
let isPlaybackActive = false;
let realTimeGps = null;

const childRoutes = {
  robert: [
    { lat: 40.4168, lng: -3.7038, time: "08:15", label: "Casa (Salida)", speed: "0 km/h" },
    { lat: 40.4192, lng: -3.7056, time: "08:30", label: "Camino al Colegio", speed: "12 km/h" },
    { lat: 40.4221, lng: -3.7081, time: "09:00", label: "Colegio (Llegada)", speed: "0 km/h" },
    { lat: 40.4225, lng: -3.7083, time: "14:15", label: "Salida del Colegio", speed: "4 km/h" },
    { lat: 40.4205, lng: -3.7099, time: "14:35", label: "Biblioteca Municipal", speed: "0 km/h" },
    { lat: 40.4175, lng: -3.7121, time: "17:30", label: "Parque Deportivo", speed: "6 km/h" },
    { lat: 40.4152, lng: -3.7085, time: "19:45", label: "Supermercado", speed: "3 km/h" },
    { lat: 40.4168, lng: -3.7038, time: "20:00", label: "Llegada a Casa", speed: "0 km/h" }
  ],
  mateo: [
    { lat: 40.4168, lng: -3.7038, time: "09:00", label: "Casa (Inicio)", speed: "0 km/h" },
    { lat: 40.4132, lng: -3.7012, time: "09:20", label: "Paseo por el barrio", speed: "5 km/h" },
    { lat: 40.4111, lng: -3.6985, time: "09:45", label: "Gimnasio", speed: "0 km/h" },
    { lat: 40.4128, lng: -3.6999, time: "12:15", label: "Cafetería Starbucks", speed: "2 km/h" },
    { lat: 40.4150, lng: -3.7020, time: "13:30", label: "Camino de vuelta", speed: "4 km/h" },
    { lat: 40.4168, lng: -3.7038, time: "14:00", label: "De vuelta en Casa", speed: "0 km/h" }
  ]
};

function getRouteHistoryForActiveChild() {
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  if (!activeChild) return [];
  
  const nameKey = activeChild.name.toLowerCase();
  if (childRoutes[nameKey]) {
    return childRoutes[nameKey];
  }
  
  // Generar ruta dinámica coherente alrededor de su posición actual
  const baseLat = (activeChild.gps && activeChild.gps.lat) ? parseFloat(activeChild.gps.lat) : 40.4168;
  const baseLng = (activeChild.gps && activeChild.gps.lng) ? parseFloat(activeChild.gps.lng) : -3.7038;
  
  return [
    { lat: baseLat, lng: baseLng, time: "15:00", label: "Casa (Salida)", speed: "0 km/h" },
    { lat: baseLat + 0.0006, lng: baseLng - 0.0008, time: "15:20", label: "Punto de paso A", speed: "5 km/h" },
    { lat: baseLat + 0.0014, lng: baseLng - 0.0015, time: "15:45", label: "Centro de Estudios", speed: "15 km/h" },
    { lat: baseLat + 0.0022, lng: baseLng - 0.0010, time: "16:20", label: "Biblioteca", speed: "0 km/h" },
    { lat: baseLat + 0.0010, lng: baseLng + 0.0005, time: "17:15", label: "Camino de vuelta", speed: "22 km/h" },
    { lat: baseLat, lng: baseLng, time: "18:00", label: "Llegada a Casa", speed: "0 km/h" }
  ];
}

function updatePlaybackUI() {
  const routePoints = getRouteHistoryForActiveChild();
  if (routePoints.length === 0) return;

  const currentPoint = routePoints[currentPlaybackIndex];
  if (!currentPoint) return;

  // Mover el marcador y centrar
  if (map && childMarker) {
    const newPos = [currentPoint.lat, currentPoint.lng];
    childMarker.setLatLng(newPos);
    map.panTo(newPos);

    const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
    const childName = activeChild ? activeChild.name : 'Hijo';
    const batteryStr = activeChild && activeChild.battery !== undefined ? ` 🔋 ${activeChild.battery}%` : '';

    childMarker.setPopupContent(`<b>${childName}${batteryStr} (Ruta)</b><br>📍 Coord: ${currentPoint.lat.toFixed(4)}, ${currentPoint.lng.toFixed(4)}<br>⚡ Vel: ${currentPoint.speed} • 🕒 ${currentPoint.time} (${currentPoint.label})`).openPopup();
  }

  // Actualizar el deslizador (slider)
  const slider = document.getElementById('playback-slider');
  if (slider) {
    slider.max = routePoints.length - 1;
    slider.value = currentPlaybackIndex;
  }

  // Actualizar etiqueta de estado
  const statusText = document.getElementById('playback-status-text');
  if (statusText) {
    statusText.textContent = `Punto ${currentPlaybackIndex + 1}/${routePoints.length} • ${currentPoint.time} - ${currentPoint.label} (${currentPoint.speed})`;
  }
}

function togglePlayback() {
  const routePoints = getRouteHistoryForActiveChild();
  if (routePoints.length === 0) {
    alert('No hay historial de ruta disponible.');
    return;
  }

  const playBtn = document.getElementById('btn-playback-play');
  const playLabel = document.getElementById('lbl-playback-play');
  const playIcon = document.getElementById('icon-playback-play');

  if (isPlaybackActive) {
    // PAUSAR REPRODUCCIÓN
    clearInterval(playbackInterval);
    playbackInterval = null;
    isPlaybackActive = false;
    if (playLabel) playLabel.textContent = "Ver Ruta";
    if (playIcon) {
      playIcon.setAttribute('data-lucide', 'play');
      lucide.createIcons();
    }
  } else {
    // INICIAR REPRODUCCIÓN
    isPlaybackActive = true;
    if (playLabel) playLabel.textContent = "Pausar";
    if (playIcon) {
      playIcon.setAttribute('data-lucide', 'pause');
      lucide.createIcons();
    }

    // Salvar posición real time de respaldo antes de iniciar la simulación
    if (!realTimeGps && map && childMarker) {
      const currentPos = childMarker.getLatLng();
      const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
      realTimeGps = {
        lat: currentPos.lat,
        lng: currentPos.lng,
        speed: document.getElementById('current-speed')?.textContent || '0 km/h',
        timestamp: 'En vivo',
        device: activeChild ? activeChild.device : 'Smartphone'
      };
    }

    // Dibujar línea de la ruta (polyline) en violeta/azul
    const latlngs = routePoints.map(p => [p.lat, p.lng]);
    if (playbackPolyline) map.removeLayer(playbackPolyline);
    
    playbackPolyline = L.polyline(latlngs, {
      color: '#6366f1',
      weight: 5,
      opacity: 0.85,
      dashArray: '6, 8',
      lineJoin: 'round'
    }).addTo(map);

    // Ajustar el zoom del mapa a la ruta completa
    map.fitBounds(playbackPolyline.getBounds(), { padding: [40, 40] });

    updatePlaybackUI();

    playbackInterval = setInterval(() => {
      currentPlaybackIndex++;
      if (currentPlaybackIndex >= routePoints.length) {
        currentPlaybackIndex = 0; // Bucle
      }
      updatePlaybackUI();
    }, 2000);
  }
}

function stepPlayback(direction) {
  const routePoints = getRouteHistoryForActiveChild();
  if (routePoints.length === 0) return;

  if (isPlaybackActive) {
    togglePlayback(); // Pausar
  }

  currentPlaybackIndex += direction;
  if (currentPlaybackIndex < 0) currentPlaybackIndex = routePoints.length - 1;
  if (currentPlaybackIndex >= routePoints.length) currentPlaybackIndex = 0;

  updatePlaybackUI();
}

function onPlaybackSliderChange(value) {
  const routePoints = getRouteHistoryForActiveChild();
  if (routePoints.length === 0) return;

  if (isPlaybackActive) {
    togglePlayback(); // Pausar
  }

  currentPlaybackIndex = parseInt(value);
  updatePlaybackUI();
}

function stopPlaybackModeAndRestoreRealTime() {
  if (isPlaybackActive) {
    togglePlayback();
  }
  if (playbackPolyline) {
    map.removeLayer(playbackPolyline);
    playbackPolyline = null;
  }
  if (realTimeGps && map && childMarker) {
    childMarker.setLatLng([realTimeGps.lat, realTimeGps.lng]);
    map.setView([realTimeGps.lat, realTimeGps.lng], 15);
    
    const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
    const childName = activeChild ? activeChild.name : 'Hijo';
    const batteryStr = activeChild && activeChild.battery !== undefined ? ` 🔋 ${activeChild.battery}%` : '';
    
    childMarker.setPopupContent(`<b>${childName}${batteryStr}</b><br>📍 Coord: ${realTimeGps.lat.toFixed(4)}, ${realTimeGps.lng.toFixed(4)}<br>⚡ Vel: ${realTimeGps.speed} • 🕒 ${realTimeGps.timestamp}`).openPopup();
    
    const speedEl = document.getElementById('current-speed');
    if (speedEl) speedEl.textContent = realTimeGps.speed;
  }
  realTimeGps = null;
  currentPlaybackIndex = 0;
  
  const statusText = document.getElementById('playback-status-text');
  if (statusText) statusText.textContent = "Monitoreando en Vivo";
}

// CONTROLADOR DE MAPA EN PANTALLA COMPLETA
function toggleMapFullscreen() {
  const mapContainer = document.querySelector('.map-container');
  const enterBtn = document.getElementById('btn-enter-fullscreen-map');
  const closeBtn = document.getElementById('btn-close-fullscreen-map');
  
  if (mapContainer.classList.contains('fullscreen-map')) {
    mapContainer.classList.remove('fullscreen-map');
    if (closeBtn) closeBtn.style.display = 'none';
    if (enterBtn) enterBtn.style.display = 'flex';
  } else {
    mapContainer.classList.add('fullscreen-map');
    if (closeBtn) closeBtn.style.display = 'flex';
    if (enterBtn) enterBtn.style.display = 'none';
  }
  
  // Forzar redibujado de Leaflet para reajustar tamaño
  setTimeout(() => {
    if (map) {
      map.invalidateSize();
    }
  }, 350);
}

// ══════════════════════════════════════════════════════════════
// RUTINAS AUTOMATIZADAS — CRUD COMPLETO
// ══════════════════════════════════════════════════════════════

const DEFAULT_ROUTINES = [
  { id: 'routine_default_1', emoji: '🏫', name: 'Modo Colegio',    days: ['L','M','X','J','V'], start: '08:30', end: '14:00', active: false },
  { id: 'routine_default_2', emoji: '📚', name: 'Modo Estudio',    days: ['L','M','X','J'],     start: '17:00', end: '19:00', active: false },
  { id: 'routine_default_3', emoji: '🌙', name: 'Modo Noche',      days: ['L','M','X','J','V','S','D'], start: '21:30', end: '07:30', active: false }
];

function loadRoutinesFromLocalStorageFallback() {
  try {
    const saved = localStorage.getItem('kidapp_routines');
    if (saved) {
      state.routines = JSON.parse(saved);
    } else {
      // Primera vez: cargar las rutinas por defecto
      state.routines = DEFAULT_ROUTINES;
      localStorage.setItem('kidapp_routines', JSON.stringify(state.routines));
    }
  } catch (e) {
    state.routines = DEFAULT_ROUTINES;
  }
}

function saveRoutinesToStorage() {
  localStorage.setItem('kidapp_routines', JSON.stringify(state.routines));
  fetch(`${BACKEND_URL}/api/routines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ childId: state.activeChild, routines: state.routines })
  }).catch(e => console.error('Error guardando rutinas en servidor:', e));
}

function renderRoutinesList() {
  const container = document.getElementById('routines-list');
  if (!container) return;

  if (!state.routines || state.routines.length === 0) {
    container.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding:16px;">No hay rutinas. Pulsa "+ Nueva" para crear una.</p>`;
    return;
  }

  container.innerHTML = '';
  state.routines.forEach((routine, index) => {
    const daysLabel = formatDaysLabel(routine.days);
    const item = document.createElement('div');
    item.className = `routine-item${routine.active ? ' active-routine' : ''}`;
    item.id = `routine-${routine.id}`;
    
    const isFirst = index === 0;
    const isLast = index === state.routines.length - 1;

    item.innerHTML = `
      <span class="routine-emoji" style="margin-top: 4px; align-self: flex-start;">${routine.emoji}</span>
      <div class="routine-info" style="display:flex; flex-direction:column; gap:2px; flex:1; min-width:0;">
        <span class="routine-name" style="font-size:0.95rem; font-weight:750; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${routine.name}</span>
        <span class="routine-meta" style="font-size:0.78rem; color:var(--text-muted);">${daysLabel} · ${routine.start} – ${routine.end}</span>
        
        <!-- Fila inferior: activar, editar y eliminar -->
        <div style="display:flex; align-items:center; gap:20px; margin-top:10px;">
          <!-- Switch Activar/Desactivar -->
          <label class="toggle-switch" title="${routine.active ? 'Desactivar' : 'Activar'}" style="margin: 0;">
            <input type="checkbox" ${routine.active ? 'checked' : ''} onchange="toggleRoutineActive('${routine.id}', this.checked)">
            <span class="slider"></span>
          </label>
          
          <!-- Editar -->
          <button class="btn-routine-action-mini" onclick="openRoutineModal('${routine.id}')" title="Editar" style="width:32px; height:32px;">
            <i data-lucide="pencil" style="width:13px;height:13px;"></i>
          </button>
          
          <!-- Eliminar -->
          <button class="btn-routine-action-mini delete" onclick="deleteRoutine('${routine.id}')" title="Eliminar" style="width:32px; height:32px;">
            <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
          </button>
        </div>
      </div>
      
      <!-- Lateral derecho: Flechas de ordenamiento -->
      <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0; align-items:center; justify-content:center; border-left:1px solid var(--border-light); padding-left:10px; margin-left:4px;">
        <button class="btn-routine-action-mini" onclick="moveRoutineUp('${routine.id}')" title="Subir" ${isFirst ? 'disabled style="opacity:0.25; pointer-events:none;"' : ''} style="width:32px; height:32px;">
          <i data-lucide="chevron-up" style="width:16px;height:16px;"></i>
        </button>
        <button class="btn-routine-action-mini" onclick="moveRoutineDown('${routine.id}')" title="Bajar" ${isLast ? 'disabled style="opacity:0.25; pointer-events:none;"' : ''} style="width:32px; height:32px;">
          <i data-lucide="chevron-down" style="width:16px;height:16px;"></i>
        </button>
      </div>
    `;
    container.appendChild(item);
  });
  lucide.createIcons();
}

function formatDaysLabel(days) {
  if (!days || days.length === 0) return 'Sin días';
  const all = ['L','M','X','J','V','S','D'];
  if (days.length === 7) return 'Todos los días';
  if (JSON.stringify(days) === JSON.stringify(['L','M','X','J','V'])) return 'Lunes a Viernes';
  if (JSON.stringify(days) === JSON.stringify(['S','D'])) return 'Fines de semana';
  return days.join(', ');
}

// ── Modal crear / editar ──────────────────────────────────────
let _editingRoutineId = null;

function openRoutineModal(routineId = null) {
  _editingRoutineId = routineId;
  const modal = document.getElementById('routine-modal');
  const title = document.getElementById('routine-modal-title');
  const nameInput = document.getElementById('routine-name-input');
  const startInput = document.getElementById('routine-start');
  const endInput = document.getElementById('routine-end');
  const dayCheckboxes = document.querySelectorAll('.routine-day');
  const emojiBtn = document.getElementById('routine-emoji-btn');

  if (routineId) {
    // Modo edición
    const r = state.routines.find(x => x.id === routineId);
    if (!r) return;
    title.textContent = 'Editar Rutina';
    nameInput.value = r.name;
    startInput.value = r.start;
    endInput.value = r.end;
    emojiBtn.textContent = r.emoji;
    dayCheckboxes.forEach(cb => {
      cb.checked = r.days.includes(cb.value);
    });
  } else {
    // Modo crear
    title.textContent = 'Nueva Rutina';
    nameInput.value = '';
    startInput.value = '08:00';
    endInput.value = '14:00';
    emojiBtn.textContent = '🕐';
    dayCheckboxes.forEach(cb => cb.checked = false);
  }

  modal.classList.add('active');
  lucide.createIcons();
}

function closeRoutineModal() {
  const modal = document.getElementById('routine-modal');
  if (modal) modal.classList.remove('active');
  const picker = document.getElementById('emoji-picker');
  if (picker) picker.style.display = 'none';
  _editingRoutineId = null;
}

function saveRoutine() {
  const name = document.getElementById('routine-name-input').value.trim();
  const start = document.getElementById('routine-start').value;
  const end = document.getElementById('routine-end').value;
  const emoji = document.getElementById('routine-emoji-btn').textContent.trim();
  const days = Array.from(document.querySelectorAll('.routine-day:checked')).map(cb => cb.value);

  if (!name) { showToast('⚠️ Introduce el nombre de la rutina.', 'error'); return; }
  if (days.length === 0) { showToast('⚠️ Selecciona al menos un día.', 'error'); return; }

  if (_editingRoutineId) {
    // Editar existente
    const r = state.routines.find(x => x.id === _editingRoutineId);
    if (r) { r.name = name; r.start = start; r.end = end; r.emoji = emoji; r.days = days; }
  } else {
    // Crear nueva
    state.routines.push({
      id: `routine_${Date.now()}`,
      emoji, name, days, start, end,
      active: true
    });
  }

  saveRoutinesToStorage();
  renderRoutinesList();
  closeRoutineModal();
  showToast(`✅ Rutina "${name}" guardada.`, 'success');

  // Emitir por WebSocket
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'ROUTINES_UPDATED', routines: state.routines }));
  }
}

function deleteRoutine(routineId) {
  const r = state.routines.find(x => x.id === routineId);
  if (!r) return;

  const modal = document.getElementById('delete-routine-modal');
  const desc = document.getElementById('delete-routine-modal-desc');
  const confirmBtn = document.getElementById('btn-confirm-delete-routine');

  if (!modal || !desc || !confirmBtn) {
    // Fallback si no existen los elementos custom
    if (confirm(`⚠️ ¿Deseas eliminar la rutina "${r.name}"?`)) {
      executeDeleteRoutineAction(routineId);
    }
    return;
  }

  desc.innerHTML = `¿Estás seguro de que deseas eliminar la rutina <strong>${r.emoji} ${r.name}</strong>?<br><br>Dejará de aplicarse automáticamente en el dispositivo del menor.`;

  confirmBtn.onclick = function() {
    executeDeleteRoutineAction(routineId);
    closeDeleteRoutineModal();
  };

  modal.classList.add('active');
  lucide.createIcons();
}

function closeDeleteRoutineModal() {
  const modal = document.getElementById('delete-routine-modal');
  if (modal) modal.classList.remove('active');
}

function executeDeleteRoutineAction(routineId) {
  const r = state.routines.find(x => x.id === routineId);
  if (!r) return;

  state.routines = state.routines.filter(x => x.id !== routineId);
  saveRoutinesToStorage();
  renderRoutinesList();
  showToast(`🗑️ Rutina "${r.name}" eliminada.`, 'success');
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'ROUTINES_UPDATED', routines: state.routines }));
  }
}

function moveRoutineUp(routineId) {
  const index = state.routines.findIndex(r => r.id === routineId);
  if (index <= 0) return;

  // Intercambiar posiciones
  const temp = state.routines[index];
  state.routines[index] = state.routines[index - 1];
  state.routines[index - 1] = temp;

  saveRoutinesToStorage();
  renderRoutinesList();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'ROUTINES_UPDATED', routines: state.routines }));
  }
}

function moveRoutineDown(routineId) {
  const index = state.routines.findIndex(r => r.id === routineId);
  if (index === -1 || index >= state.routines.length - 1) return;

  // Intercambiar posiciones
  const temp = state.routines[index];
  state.routines[index] = state.routines[index + 1];
  state.routines[index + 1] = temp;

  saveRoutinesToStorage();
  renderRoutinesList();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'ROUTINES_UPDATED', routines: state.routines }));
  }
}

function toggleRoutineActive(routineId, isActive) {
  const r = state.routines.find(x => x.id === routineId);
  if (!r) return;
  r.active = isActive;
  // Actualizar clase visual sin re-render completo
  const item = document.getElementById(`routine-${routineId}`);
  if (item) item.classList.toggle('active-routine', isActive);
  saveRoutinesToStorage();
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'ROUTINES_UPDATED', routines: state.routines }));
  }
}

// ── Emoji picker ──────────────────────────────────────────────
function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  picker.style.display = picker.style.display === 'none' || !picker.style.display ? 'block' : 'none';
}

function selectEmoji(emoji) {
  const btn = document.getElementById('routine-emoji-btn');
  if (btn) btn.textContent = emoji;
  const picker = document.getElementById('emoji-picker');
  if (picker) picker.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// WEB PUSH NOTIFICATIONS — SUSCRIPCIÓN DEL PADRE
// ══════════════════════════════════════════════════════════════

const VAPID_PUBLIC_KEY = 'BK8xywDfDCgi5DlBZwwj8reoJaFwWfAzbgLrwXaBZ9cWo5BJD_Mm6eHaONi-TAy9dSH2ADzA7VKq6Tc--NvH_dk';

function subscribeToPushNotifications(registration) {
  if (!('PushManager' in window)) {
    console.warn('Este navegador no soporta notificaciones Push.');
    return;
  }

  // Comprobar si ya tenemos permiso o solicitarlo
  if (Notification.permission === 'default') {
    // La primera vez, pedimos permiso discretamente
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        registerSubscription(registration);
      }
    });
  } else if (Notification.permission === 'granted') {
    registerSubscription(registration);
  }
}

function registerSubscription(registration) {
  const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

  registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey
  })
  .then(subscription => {
    console.log('⚡ Suscripción Web Push exitosa:', subscription);
    // Enviar suscripción a nuestro servidor en Render
    return fetch(`${BACKEND_URL}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });
  })
  .then(res => res.json())
  .then(data => {
    console.log('💾 Suscripción registrada en el servidor central:', data);
  })
  .catch(err => {
    console.error('Error suscribiendo a Web Push (silenciado):', err);
    // Solo registramos en consola para no molestar al usuario con banners rojos en el panel
  });
}

// Helper para convertir la clave pública VAPID base64 a un array de bytes
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// GESTIÓN DE ALERTA S.O.S. REMOTA (Dibuja la ventana modal parpadeante de emergencia)
function handleIncomingSosAlert(data) {
  console.warn("🚨 ALERTA S.O.S. RECIBIDA:", data);
  
  // 1. Reproducir sonido de alarma estridente en el terminal del padre
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // Tono de alarma alto
    osc.frequency.linearRampToValueAtTime(440, audioCtx.currentTime + 0.5); // Efecto sirena
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    osc.start();
    osc.stop(audioCtx.currentTime + 3); // Sonar durante 3 segundos
  } catch (e) {
    console.error("Error reproduciendo audio SOS:", e);
  }

  // 2. Vibración si está soportada
  if (navigator.vibrate) {
    navigator.vibrate([500, 250, 500, 250, 500]);
  }

  // 3. Agregar elemento a la lista de actividad
  if (data.event) {
    addActivityFeedItem('gps_outside', `🚨 <strong>${data.message}</strong>`, data.event.time);
  }

  // 4. Dibujar la ventana modal de pánico en la interfaz del padre
  // Si ya hay un modal abierto, quitarlo para evitar duplicidades
  const existingSos = document.getElementById('sos-panic-modal');
  if (existingSos) existingSos.remove();

  const modal = document.createElement('div');
  modal.id = 'sos-panic-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.backgroundColor = 'rgba(15, 23, 42, 0.95)';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.justifyContent = 'center';
  modal.style.alignItems = 'center';
  modal.style.zIndex = '99999';
  modal.style.padding = '24px';
  modal.style.textAlign = 'center';
  modal.style.color = '#fff';
  modal.style.fontFamily = 'system-ui, -apple-system, sans-serif';

  // Efecto de parpadeo rojo con animación CSS
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes redGlow {
      0% { box-shadow: 0 0 15px #ef4444; border-color: #ef4444; }
      50% { box-shadow: 0 0 40px #dc2626; border-color: #b91c1c; }
      100% { box-shadow: 0 0 15px #ef4444; border-color: #ef4444; }
    }
    .sos-card-panic {
      background: #1e1b4b;
      border: 3px solid #ef4444;
      border-radius: 24px;
      padding: 36px 24px;
      max-width: 450px;
      width: 100%;
      animation: redGlow 1.5s infinite;
    }
  `;
  document.head.appendChild(style);

  const activeChild = state.children.find(c => c.id === data.childId) || state.children[0];
  let childPhone = activeChild ? (activeChild.phone || '') : '';

  const card = document.createElement('div');
  card.className = 'sos-card-panic';

  card.innerHTML = `
    <div style="font-size: 64px; margin-bottom: 16px; animation: bounce 1s infinite;">🚨</div>
    <h1 style="font-size: 28px; font-weight: 800; color: #fecaca; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">¡ALERTA S.O.S.!</h1>
    <p style="font-size: 18px; line-height: 1.5; color: #f1f5f9; margin-bottom: 24px; font-weight: 600;">
      Tu hijo <strong>${data.childName || 'Lucas'}</strong> ha pulsado el botón de auxilio desde su teléfono.
    </p>
    <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px;">
      <button id="sos-unlock-btn" style="background: #10b981; color: white; border: none; padding: 16px; border-radius: 12px; font-weight: bold; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: background 0.2s;">
        🔓 DESBLOQUEAR MÓVIL AHORA
      </button>
      <a href="${childPhone ? 'tel:' + childPhone : '#'}" id="sos-call-btn" style="background: #3b82f6; color: white; text-decoration: none; padding: 16px; border-radius: 12px; font-weight: bold; font-size: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; transition: background 0.2s;">
        📞 LLAMAR POR TELÉFONO
      </a>
      <button id="sos-dismiss-btn" style="background: #475569; color: white; border: none; padding: 12px; border-radius: 12px; font-weight: 600; font-size: 14px; cursor: pointer; margin-top: 8px; transition: background 0.2s;">
        Cerrar Alerta
      </button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  // Botón: Desbloquear
  document.getElementById('sos-unlock-btn').addEventListener('click', () => {
    state.isGlobalLocked = false;
    handleRemoteLockUpdate(false, 'S.O.S. resuelto');
    try {
      fetch(`${BACKEND_URL}/api/lock/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childId: data.childId || 'child_1', isLocked: false })
      }).catch(err => console.error('Error enviando al backend en la nube:', err));
    } catch (e) {
      console.error('Error disparando API:', e);
    }
    modal.remove();
    showToast("🔓 Orden de desbloqueo remoto enviada con éxito.", "success");
  });

  // Botón: Llamar (Pide el número al vuelo si no existe y lo guarda)
  document.getElementById('sos-call-btn').addEventListener('click', (e) => {
    if (!childPhone) {
      e.preventDefault();
      const num = prompt("Introduce el número de teléfono de tu hijo/a para poder llamarle:");
      if (num) {
        childPhone = num.trim();
        if (activeChild) {
          activeChild.phone = childPhone;
          // 1. Guardar localmente
          localStorage.setItem('kidapp_children', JSON.stringify(state.children));
          // 2. Guardar en el servidor central
          fetch(`${BACKEND_URL}/api/children`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ child: activeChild })
          }).catch(err => console.error('Error guardando telf en servidor:', err));
        }
        window.location.href = `tel:${childPhone}`;
      }
    }
  });

  // Botón: Cerrar
  document.getElementById('sos-dismiss-btn').addEventListener('click', () => {
    modal.remove();
  });
}

// GESTIÓN DE PETICIÓN DE LLAMADA REMOTA (Dibuja una ventana modal amistosa y menos alarmante)
function handleIncomingCallRequest(data) {
  console.log("📞 PETICIÓN DE LLAMADA RECIBIDA:", data);

  // 1. Sonar un tono de llamada corto y agradable
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    const playBeep = (startTime) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, startTime); // Nota D5 (tono agradable y claro)
      
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.05);
      gain.gain.setValueAtTime(0.15, startTime + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    };

    const now = audioCtx.currentTime;
    playBeep(now);
    playBeep(now + 0.5);
    playBeep(now + 1.0);
  } catch (e) {
    console.error("Error reproduciendo audio de llamada:", e);
  }

  // 2. Agregar elemento a la lista de actividad
  if (data.event) {
    addActivityFeedItem('gps', `📞 <strong>${data.message}</strong>`, data.event.time);
  }

  // 3. Dibujar la ventana modal amigable en la interfaz del padre
  const existingCall = document.getElementById('call-request-modal');
  if (existingCall) existingCall.remove();

  const modal = document.createElement('div');
  modal.id = 'call-request-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.backgroundColor = 'rgba(15, 23, 42, 0.7)'; // Menos opaco, más suave
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.justifyContent = 'center';
  modal.style.alignItems = 'center';
  modal.style.zIndex = '99999';
  modal.style.padding = '24px';
  modal.style.textAlign = 'center';
  modal.style.color = '#1e293b';
  modal.style.fontFamily = "'Outfit', 'Segoe UI', system-ui, sans-serif";

  // Estilos de la tarjeta amigable (diseño azul claro / verde suave en lugar de rojo parpadeante)
  const style = document.createElement('style');
  style.innerHTML = `
    .call-card-request {
      background: #ffffff;
      border: 2px solid #3b82f6;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      border-radius: 24px;
      padding: 36px 24px;
      max-width: 450px;
      width: 100%;
      text-align: center;
      transition: all 0.3s ease;
    }
  `;
  document.head.appendChild(style);

  const activeChild = state.children.find(c => c.id === data.childId) || state.children[0];
  let childPhone = activeChild ? (activeChild.phone || '') : '';

  const card = document.createElement('div');
  card.className = 'call-card-request';

  card.innerHTML = `
    <div style="font-size: 54px; margin-bottom: 16px;">📞</div>
    <h1 style="font-size: 24px; font-weight: 800; color: #1e3a8a; margin: 0 0 12px 0;">¿Puedes llamarme?</h1>
    <p style="font-size: 15px; line-height: 1.5; color: #475569; margin-bottom: 24px; font-weight: 500;">
      Tu hijo <strong>${data.childName || 'Lucas'}</strong> te ha enviado una solicitud desde su móvil bloqueado para que le llames.
    </p>
    <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px;">
      <a href="${childPhone ? 'tel:' + childPhone : '#'}" id="call-req-phone-btn" style="background: #2563eb; color: white; text-decoration: none; padding: 14px; border-radius: 12px; font-weight: bold; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 8px; transition: background 0.2s;">
        📞 LLAMAR AHORA
      </a>
      <button id="call-req-dismiss-btn" style="background: #e2e8f0; color: #475569; border: none; padding: 12px; border-radius: 12px; font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s;">
        Cerrar Petición
      </button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  // Botón: Llamar (Pide el número al vuelo si no existe y lo guarda)
  document.getElementById('call-req-phone-btn').addEventListener('click', (e) => {
    if (!childPhone) {
      e.preventDefault();
      const num = prompt("Introduce el número de teléfono de tu hijo/a para poder llamarle:");
      if (num) {
        childPhone = num.trim();
        if (activeChild) {
          activeChild.phone = childPhone;
          // 1. Guardar localmente
          localStorage.setItem('kidapp_children', JSON.stringify(state.children));
          // 2. Guardar en el servidor central
          fetch(`${BACKEND_URL}/api/children`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ child: activeChild })
          }).catch(err => console.error('Error guardando telf en servidor:', err));
        }
        window.location.href = `tel:${childPhone}`;
      }
    }
  });

  // Botón: Cerrar
  document.getElementById('call-req-dismiss-btn').addEventListener('click', () => {
    modal.remove();
  });
}

// TOGGLE COLLAPSIBLE CARDS IN RULES TAB
function toggleCollapsible(headerElement) {
  const card = headerElement.closest('.collapsible-card');
  if (card) {
    card.classList.toggle('collapsed');
  }
}

// GESTIONAR DESPLIEGUE EXCLUSIVO DE ACORDEONES
function toggleAccordion(headerElement) {
  const item = headerElement.closest('.accordion-item');
  if (!item) return;
  const isExpanded = item.classList.contains('expanded');
  
  // Colapsar todos los acordeones del dashboard
  document.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('expanded'));
  
  // Si no estaba expandido, abrirlo ahora
  if (!isExpanded) {
    item.classList.add('expanded');
    
    // Si se trata del GPS, recalcular mapa de Leaflet
    if (item.id === 'acc-gps' && map) {
      setTimeout(() => {
        map.invalidateSize();
      }, 150);
    }
  }
}

// NAVEGACIÓN: IR AL SELECTOR DE HIJOS
function goHome() {
  state.activeChild = null;
  localStorage.removeItem('kidapp_active_child');
  
  const selectorEl = document.getElementById('child-selector-view');
  if (selectorEl) selectorEl.style.display = 'block';
  const profileEl = document.getElementById('child-profile-view');
  if (profileEl) profileEl.style.display = 'none';
  
  const navBar = document.getElementById('main-nav-bar');
  if (navBar) navBar.style.display = 'none';
  
  renderChildrenSelector();
}

// NAVEGACIÓN: SELECCIONAR HIJO Y TRANSICIONAR AL PERFIL
function selectChild(childId) {
  state.activeChild = childId;
  localStorage.setItem('kidapp_active_child', childId);
  
  const selectorEl = document.getElementById('child-selector-view');
  if (selectorEl) selectorEl.style.display = 'none';
  const profileEl = document.getElementById('child-profile-view');
  if (profileEl) profileEl.style.display = 'block';
  
  const navBar = document.getElementById('main-nav-bar');
  if (navBar) navBar.style.display = 'flex';
  
  // Sincronizar todos los filtros y límites del menor seleccionado
  switchChild(childId);
  
  if (map) {
    setTimeout(() => {
      map.invalidateSize();
    }, 200);
  }
}

// RENDERIZAR BANNER DE CABECERA DEL HIJO ACTIVO
function renderActiveChildHeader() {
  const container = document.getElementById('active-child-card-header');
  if (!container) return;
  
  const activeChild = state.children.find(c => c.id === state.activeChild) || state.children[0];
  if (!activeChild) {
    container.innerHTML = '';
    return;
  }
  
  const isOnline = activeChild.device && activeChild.device !== 'Emparejando por QR...' && activeChild.device !== 'Offline';
  
  container.innerHTML = `
    <div class="card glass-card active-child-profile-card" style="width: 100%; box-sizing: border-box;">
      <div class="profile-avatar">${activeChild.avatar || '👦'}</div>
      <div class="profile-info">
        <h2 class="profile-name">${activeChild.name}</h2>
        <div class="profile-details-row">
          <span class="profile-device-model"><i data-lucide="smartphone" style="width: 14px; height: 14px;"></i> ${activeChild.device || 'Android'}</span>
          <span class="profile-battery"><i data-lucide="battery" style="width: 14px; height: 14px;"></i> ${activeChild.battery || 100}%</span>
          <span class="profile-connection-status ${isOnline ? 'online' : 'offline'}">
            ● ${isOnline ? 'Conectado en vivo' : 'Desconectado'}
          </span>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();
}

// RENDERIZAR REJILLA DEL SELECTOR DE HIJOS
function renderChildrenSelector() {
  const grid = document.getElementById('selector-children-grid');
  if (!grid) return;
  grid.innerHTML = '';
  
  if (!state.children || state.children.length === 0) {
    grid.innerHTML = `
      <div class="card glass-card" style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted);">
        <i data-lucide="users" style="width: 48px; height: 48px; color: var(--primary); margin-bottom: 12px; opacity: 0.5; display: inline-block;"></i>
        <p>No tienes ningún hijo registrado todavía.</p>
        <p style="font-size: 0.85rem; margin-top: 4px;">Pulsa el botón de abajo para empezar.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  state.children.forEach(child => {
    const isOnline = child.device && child.device !== 'Emparejando por QR...' && child.device !== 'Offline';
    const dotClass = isOnline ? 'dot-online' : 'dot-offline';
    
    const card = document.createElement('div');
    card.className = 'children-select-card';
    if (state.activeChild === child.id) {
      card.classList.add('selected');
    }
    
    card.innerHTML = `
      <div class="card-left" onclick="selectChild('${child.id}')">
        <div class="avatar">${child.avatar || '👦'}</div>
        <div class="info">
          <div class="name-row">
            <span class="${dotClass}" title="${isOnline ? 'En línea' : 'Desconectado'}">●</span>
            <span class="name">${child.name}</span>
          </div>
          <div class="battery-row">
            <i data-lucide="battery" style="width: 14px; height: 14px;"></i>
            <span>${child.battery || 100}%</span>
          </div>
        </div>
      </div>
      <div class="card-right">
        <button class="btn-delete" onclick="event.stopPropagation(); unpairDevice('${child.id}', '${child.name}', '${child.device}')" title="Eliminar Hijo">
          <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
        </button>
      </div>
    `;
    grid.appendChild(card);
  });
  
  lucide.createIcons();
}


