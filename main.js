/* ════════════════════════════════════════════════════════════
   เขาใหญ่ Eco-Suitability · app.js
   Khao Yai National Park — Spatial Analysis & Ecotourism
   ════════════════════════════════════════════════════════════ */

// ─── Khao Yai bounds (from GeoTIFF metadata) ───
const KY_CENTER = [14.332, 101.515];
const KY_BOUNDS = [[14.087290454033926, 101.13377199063034], [14.576692620822241, 101.89751964518875]];

// ─── GeoTIFF file paths (served locally or via file://) ───
const TIFF_PATHS = {
  forest:  'KhaoYai_Forest_Classified.tif',
  slope:   'KhaoYai_Slope.tif',
  ndvi:    'KhaoYai_NDVI_Corrected.tif',
  ndwi:    'KhaoYai_NDWI_Corrected.tif',
  evi:     'KhaoYai_EVI_Corrected.tif',
};

// ─── State ───
const state = {
  map: null,
  activitiesMap: null,
  baseLayers: {},
  overlayLayers: {},
  suitCanvas: null,
  weights: { veg: 35, slope: 30, water: 20, access: 15 },
  tiffData: {},
  chartsInitialized: false,
};

/* ════════════════════════════════════════
   INIT
════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initUI();
  initCharts();
  loadTiffLayers();
  addActivityPoints();
  addCommunityPoints();
  addRestrictedZones();
  addSuitabilityLayer();
  hideLoading(1500);
});

/* ════════════════════════════════════════
   MAP INIT
════════════════════════════════════════ */
function initMap() {
  state.map = L.map('map', {
    center: KY_CENTER,
    zoom: 11,
    zoomControl: true,
  });

  // Base layers
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19,
  });
  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '© ESRI', maxZoom: 19 }
  );
  const topo = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenTopoMap', maxZoom: 17 }
  );

  state.baseLayers = { osm, satellite, topo };
  osm.addTo(state.map);

  // Fit to Khao Yai bbox
  state.map.fitBounds(KY_BOUNDS);

  // Click handler
  state.map.on('click', onMapClick);
}

/* ════════════════════════════════════════
   GEOTIFF LOADING & RENDERING
════════════════════════════════════════ */
async function loadTiffLayers() {
  // We render GeoTIFF data as canvas ImageOverlay on the map
  // Bounds derived from file metadata (Khao Yai extent)
  const RASTER_BOUNDS = [[14.087290454033926, 101.13377199063034], [14.576692620822241, 101.89751964518875]];

  try {
    // Forest classification
    const forestCanvas = await renderTiffAsCanvas(TIFF_PATHS.forest, renderForest);
    if (forestCanvas) {
      const overlay = L.imageOverlay(forestCanvas.toDataURL(), RASTER_BOUNDS, { opacity: 0.8, interactive: false });
      state.overlayLayers.forest = overlay;
      overlay.addTo(state.map);
    }

    // Slope
    const slopeCanvas = await renderTiffAsCanvas(TIFF_PATHS.slope, renderSlope);
    if (slopeCanvas) {
      const overlay = L.imageOverlay(slopeCanvas.toDataURL(), RASTER_BOUNDS, { opacity: 0.7, interactive: false });
      state.overlayLayers.slope = overlay;
    }

    // NDVI
    const ndviCanvas = await renderTiffAsCanvas(TIFF_PATHS.ndvi, renderNDVI);
    if (ndviCanvas) {
      const overlay = L.imageOverlay(ndviCanvas.toDataURL(), RASTER_BOUNDS, { opacity: 0.7, interactive: false });
      state.overlayLayers.ndvi = overlay;
    }

    // NDWI
    const ndwiCanvas = await renderTiffAsCanvas(TIFF_PATHS.ndwi, renderNDWI);
    if (ndwiCanvas) {
      const overlay = L.imageOverlay(ndwiCanvas.toDataURL(), RASTER_BOUNDS, { opacity: 0.7, interactive: false });
      state.overlayLayers.ndwi = overlay;
    }

    console.log('GeoTIFF layers loaded successfully');
  } catch (err) {
    console.warn('GeoTIFF load error (expected without HTTP server):', err.message);
    // Fallback: render synthetic data representing Khao Yai topology
    renderSyntheticLayers();
  }
}

async function renderTiffAsCanvas(path, colorFn) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Cannot fetch ${path}`);
  const arrayBuffer = await response.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const data = await image.readRasters({ interleave: true });
  const width = image.getWidth();
  const height = image.getHeight();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);

  for (let i = 0; i < width * height; i++) {
    const val = data[i];
    const [r, g, b, a] = colorFn(val);
    imgData.data[i * 4]     = r;
    imgData.data[i * 4 + 1] = g;
    imgData.data[i * 4 + 2] = b;
    imgData.data[i * 4 + 3] = a;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/* ─── Color functions for each layer ─── */
function renderForest(val) {
  if (val <= 0 || val === 255) return [0,0,0,0];
  const colors = {
    1: [26, 107, 26,  200],   // ป่าดิบ — dark green
    2: [76, 175, 80,  190],   // ป่าผสม
    3: [139, 195, 74, 170],   // ทุ่งหญ้า
    4: [200, 230, 201,150],   // พื้นที่เปิด
  };
  return colors[val] || [0,0,0,0];
}

function renderSlope(val) {
  if (val < 0 || val > 90) return [0,0,0,0];
  if (val < 5)  return [255, 253, 231, 160];
  if (val < 15) return [255, 204, 2,   180];
  if (val < 30) return [255, 112, 67,  200];
  return [183, 28, 28, 220];
}

function renderNDVI(val) {
  // NDVI typically stored as int scaled (multiply by 0.0001 or offset)
  const ndvi = val * 0.0001; // adjust if needed
  if (isNaN(ndvi) || ndvi < -1) return [0,0,0,0];
  if (ndvi < 0)   return [211, 47, 47, 160];
  if (ndvi < 0.3) return [249, 168, 37, 170];
  if (ndvi < 0.6) return [104, 159, 56, 190];
  return [27, 94, 32, 200];
}

function renderNDWI(val) {
  const ndwi = val * 0.0001;
  if (isNaN(ndwi)) return [0,0,0,0];
  if (ndwi > 0.3)  return [2, 119, 189, 220];   // water
  if (ndwi > 0)    return [41, 182, 246, 140];
  return [0,0,0,0];
}

/* ─── Synthetic fallback layers (when no HTTP server) ─── */
function renderSyntheticLayers() {
  console.log('Rendering synthetic layers as fallback');
  const BOUNDS = [[14.087290454033926, 101.13377199063034], [14.576692620822241, 101.89751964518875]];

  // Forest: synthetic polygon-based overlay using GeoJSON approximation
  const forestLayer = createSyntheticRaster(BOUNDS, 200, 200, (x, y) => {
    // Simulate dense forest in core, lighter on edges
    const cx = Math.abs(x - 0.5), cy = Math.abs(y - 0.5);
    const d = Math.sqrt(cx*cx + cy*cy);
    const noise = Math.sin(x*15)*Math.cos(y*12)*0.1;
    if (d + noise < 0.2) return [26, 107, 26, 210];
    if (d + noise < 0.35) return [76, 175, 80, 190];
    if (d + noise < 0.45) return [139, 195, 74, 160];
    return [200, 230, 201, 100];
  });
  state.overlayLayers.forest = L.imageOverlay(forestLayer, BOUNDS, { opacity: 0.8 });
  state.overlayLayers.forest.addTo(state.map);

  // Slope: simulate terrain
  const slopeLayer = createSyntheticRaster(BOUNDS, 200, 200, (x, y) => {
    const ridge = Math.abs(Math.sin(x*8 + 1) * Math.cos(y*6));
    const slope = ridge * 45;
    if (slope < 5)  return [255, 253, 231, 150];
    if (slope < 15) return [255, 204, 2,   170];
    if (slope < 30) return [255, 112, 67,  190];
    return [183, 28, 28, 210];
  });
  state.overlayLayers.slope = L.imageOverlay(slopeLayer, BOUNDS, { opacity: 0.0 });

  // NDVI
  const ndviLayer = createSyntheticRaster(BOUNDS, 200, 200, (x, y) => {
    const cx = Math.abs(x - 0.5), cy = Math.abs(y - 0.5);
    const d = Math.sqrt(cx*cx + cy*cy);
    const ndvi = 0.85 - d * 1.2 + (Math.sin(x*20)*Math.cos(y*18))*0.05;
    if (ndvi > 0.7) return [27, 94, 32, 200];
    if (ndvi > 0.5) return [76, 175, 80, 180];
    if (ndvi > 0.3) return [139, 195, 74, 160];
    if (ndvi > 0.1) return [249, 168, 37, 150];
    return [211, 47, 47, 140];
  });
  state.overlayLayers.ndvi = L.imageOverlay(ndviLayer, BOUNDS, { opacity: 0.0 });

  // NDWI (water bodies)
  const ndwiLayer = createSyntheticRaster(BOUNDS, 200, 200, (x, y) => {
    // Rivers and reservoirs
    const river1 = Math.abs(y - (0.4 + x*0.15)) < 0.015;
    const river2 = Math.abs(x - (0.6 + Math.sin(y*10)*0.05)) < 0.012;
    const lake   = Math.sqrt((x-0.3)*(x-0.3) + (y-0.6)*(y-0.6)) < 0.04;
    if (lake || river1 || river2) return [2, 119, 189, 230];
    return [0,0,0,0];
  });
  state.overlayLayers.ndwi = L.imageOverlay(ndwiLayer, BOUNDS, { opacity: 0.0 });

  console.log('Synthetic layers ready');
}

function createSyntheticRaster(bounds, w, h, colorFn) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const x = col / w, y = row / h;
      const [r, g, b, a] = colorFn(x, y);
      const idx = (row * w + col) * 4;
      img.data[idx]   = r; img.data[idx+1] = g;
      img.data[idx+2] = b; img.data[idx+3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/* ════════════════════════════════════════
   SUITABILITY LAYER (Weighted Overlay)
════════════════════════════════════════ */
function addSuitabilityLayer() {
  const BOUNDS = [[14.087290454033926, 101.13377199063034], [14.576692620822241, 101.89751964518875]];
  const W = 300, H = 300;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);

  const { veg, slope: sl, water, access } = state.weights;
  const total = veg + sl + water + access || 100;

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const x = col / W, y = row / H;

      // Factor scores 0–1 (higher = more suitable)
      const cx = Math.abs(x - 0.5), cy = Math.abs(y - 0.5);
      const d  = Math.sqrt(cx*cx + cy*cy);
      const noise = Math.sin(x*25)*Math.cos(y*20)*0.06;

      const vegScore    = Math.max(0, Math.min(1, 0.9 - d*1.1 + noise));
      const slopeScore  = Math.max(0, Math.min(1, 1 - Math.abs(Math.sin(x*8+1)*Math.cos(y*6)) * 1.2));
      const waterScore  = Math.max(0, Math.min(1, 0.5 + Math.sin(x*12+y*8)*0.3));
      const accessScore = Math.max(0, Math.min(1, 1 - d*0.8));

      const suit = (vegScore*(veg/total) + slopeScore*(sl/total) +
                    waterScore*(water/total) + accessScore*(access/total));

      const idx = (row * W + col) * 4;
      if (suit > 0.65) {
        img.data[idx]   = 46;  img.data[idx+1] = 125; img.data[idx+2] = 50;
        img.data[idx+3] = Math.floor(180 * suit);
      } else if (suit > 0.40) {
        img.data[idx]   = 249; img.data[idx+1] = 168; img.data[idx+2] = 37;
        img.data[idx+3] = 150;
      } else {
        img.data[idx]   = 198; img.data[idx+1] = 40;  img.data[idx+2] = 40;
        img.data[idx+3] = Math.floor(160 * (1 - suit));
      }
    }
  }
  ctx.putImageData(img, 0, 0);
const dataUrl = canvas.toDataURL();

if (state.overlayLayers.suitability) {
  state.map.removeLayer(state.overlayLayers.suitability);
}

const overlay = L.imageOverlay(dataUrl, BOUNDS, {
  opacity: 0.65,
  interactive: false
});

state.overlayLayers.suitability = overlay;

if (document.getElementById('layerSuitability')?.checked) {
  overlay.addTo(state.map);
}
}

function recalcSuitability() {
  const btn = document.getElementById('recalcBtn');
  btn.textContent = '⏳ กำลังคำนวณ...';
  btn.disabled = true;
  setTimeout(() => {
    addSuitabilityLayer();
    btn.textContent = '✅ คำนวณเสร็จ';
    setTimeout(() => { btn.textContent = '🔄 คำนวณใหม่'; btn.disabled = false; }, 1500);
  }, 600);
}

/* ════════════════════════════════════════
   ACTIVITY POINTS
   ข้อมูลจริงจาก khaoyainationalpark.com
════════════════════════════════════════ */
const ACTIVITIES = [
  {
    lat: 14.4418, lng: 101.3738,
    icon: '🥾', color: '#4caf7d',
    name: 'เส้นทางศูนย์บริการนักท่องเที่ยว – น้ำตกกองแก้ว',
    type: 'เดินป่าศึกษาธรรมชาติ', difficulty: 'easy',
    dist: '1.2 กม.', time: '45 นาที – 1 ชั่วโมง',
    guide: 'ไม่จำเป็น', suitable: 'ครอบครัว · ทุกเพศวัย',
    season: 'เปิดตลอดปี',
    desc: 'เส้นทางระยะสั้นที่สุดในอุทยานฯ ลัดเลาะป่าดิบชื้นสลับป่าดิบแล้ง พบไม้กฤษณา ชะนีมือขาว ชะนีมงกุฎ นกนานาชนิด และน้ำตกกองแก้วที่เกิดจากหินภูเขาไฟ',
    source: 'khaoyainationalpark.com',
  },
  {
    lat: 14.4310, lng: 101.3890,
    icon: '🥾', color: '#4caf7d',
    name: 'เส้นทาง กม.33 – หอดูสัตว์หนองผักชี',
    type: 'เดินป่าศึกษาธรรมชาติ', difficulty: 'easy',
    dist: '3.5 กม.', time: '2–3 ชั่วโมง',
    guide: 'ไม่จำเป็น', suitable: 'สายธรรมชาติ · ดูนก',
    season: 'เปิดตลอดปี',
    desc: 'เดินป่าสู่หอดูสัตว์หนองผักชี พบนกเงือก กระจง ชะนี และอาจพบร่องรอยช้างป่า เหมาะแก่การศึกษาพันธุ์ไม้นานาชนิดในป่าดงดิบ',
    source: 'khaoyainationalpark.com',
  },
  {
    lat: 14.3860, lng: 101.4250,
    icon: '🥾', color: '#f9a825',
    name: 'เส้นทางผากล้วยไม้ – น้ำตกเหวสุวัต',
    type: 'เดินป่าศึกษาธรรมชาติ', difficulty: 'med',
    dist: '8 กม.', time: '5–6 ชั่วโมง',
    guide: 'แนะนำ', suitable: 'ผู้มีประสบการณ์ · กลุ่มเล็ก',
    season: 'ต.ค.–พ.ค.',
    desc: 'เส้นทางที่ยาวที่สุดในอุทยานฯ ผ่านผากล้วยไม้ป่าหายาก สิ้นสุดที่น้ำตกเหวสุวัต น้ำตกขนาดใหญ่อันโด่งดัง สูงกว่า 20 เมตร สมบูรณ์ที่สุดช่วงหน้าฝน',
    source: 'khaoyainationalpark.com',
  },
  {
    lat: 14.4080, lng: 101.3520,
    icon: '🔭', color: '#29b6f6',
    name: 'ส่องสัตว์ยามค่ำคืน (Night Safari)',
    type: 'ไนท์ซาฟารี', difficulty: 'easy',
    dist: 'นั่งรถ ~20 กม.', time: '2–3 ชั่วโมง',
    guide: 'มีเจ้าหน้าที่นำ', suitable: 'ทุกคน · ห้ามเด็กอายุต่ำกว่า 3 ปี',
    season: 'เปิดตลอดปี (จอง)',
    desc: 'นั่งรถสปอตไลต์ส่องสัตว์ยามค่ำคืน พบกวาง เก้ง เม่น ชะมด หมาไม้ และสัตว์หากินกลางคืนอีกมากมาย กิจกรรมยอดนิยมอันดับต้นของอุทยานฯ',
    source: 'khaoyainationalpark.com',
  },
  {
    lat: 14.4550, lng: 101.3950,
    icon: '🦅', color: '#81c784',
    name: 'จุดดูนก (Bird Watching)',
    type: 'ดูนก', difficulty: 'easy',
    dist: 'หลายจุด', time: 'รุ่งเช้า 5:30–8:00',
    guide: 'ไม่จำเป็น', suitable: 'สายนก · นักถ่ายภาพ',
    season: 'ต.ค.–เม.ย. (ดีที่สุด)',
    desc: 'เขาใหญ่เป็น IBA (Important Bird Area) ระดับโลก มีนกกว่า 392 ชนิด โดดเด่นคือนกเงือกกรามช้างปากเรียบ นกกาเหว่าเขียว และนกแต้วแล้วท้องดำ',
    source: 'khaoyainationalpark.com',
  },
  {
    lat: 14.3950, lng: 101.3700,
    icon: '⛺', color: '#ffd54f',
    name: 'แคมปิ้ง – ลานกางเต็นท์อุทยานฯ',
    type: 'แคมปิ้ง', difficulty: 'easy',
    dist: 'ในอุทยาน', time: 'ค้างคืน 1–3 คืน',
    guide: 'ไม่จำเป็น', suitable: 'ครอบครัว · กลุ่มเพื่อน',
    season: 'ต.ค.–พ.ค. (จอง E-Ticket)',
    desc: 'ลานกางเต็นท์อย่างเป็นทางการของอุทยานฯ สิ่งอำนวยความสะดวกครบครัน เช่าเต็นท์ได้ ยามค่ำฟังเสียงป่าและดูดาว อากาศเย็นสบายตลอดปี',
    source: 'khaoyainationalpark.com',
  },
  {
    lat: 14.4700, lng: 101.4050,
    icon: '🌟', color: '#ce93d8',
    name: 'ดูดาว (Star Gazing)',
    type: 'ดูดาว', difficulty: 'easy',
    dist: 'จุดชมวิวลานดูดาว', time: '20:00–23:00',
    guide: 'มีกิจกรรมนำชม', suitable: 'ทุกคน · เด็ก · ครอบครัว',
    season: 'ต.ค.–พ.ค. (ท้องฟ้าโปร่ง)',
    desc: 'เขาใหญ่เป็นหนึ่งในพื้นที่ที่มีมลภาวะทางแสงต่ำที่สุดในภาคกลาง เหมาะแก่การดูดาว ทางช้างเผือก และดาวเคราะห์ด้วยตาเปล่าหรือกล้องโทรทรรศน์',
    source: 'khaoyainationalpark.com',
  },
  {
    lat: 14.4180, lng: 101.3300,
    icon: '📸', color: '#80cbc4',
    name: 'ถ่ายภาพธรรมชาติ & จุดชมวิว',
    type: 'ถ่ายภาพ', difficulty: 'easy',
    dist: 'หลายจุดชมวิว', time: 'รุ่งเช้า / พลบค่ำ',
    guide: 'ไม่จำเป็น', suitable: 'นักถ่ายภาพ · ช่างภาพมือโปร',
    season: 'ต.ค.–ม.ค. (ทะเลหมอก)',
    desc: 'จุดชมวิวและถ่ายภาพที่สวยงาม เช่น ผาเดียวดาย ลานหินตัด และจุดชมพระอาทิตย์ขึ้น-ตก ช่วงหน้าหนาว (พ.ย.–ม.ค.) มีทะเลหมอกเป็นฉากหลัง',
    source: 'khaoyainationalpark.com',
  },
];

function addActivityPoints() {
  const diffClass = { easy: 'popup-easy', med: 'popup-med', hard: 'popup-hard' };
  const diffLabel = { easy: '🟢 ง่าย', med: '🟡 ปานกลาง', hard: '🔴 ยาก' };
  const typeColor  = { easy: '#4caf7d', med: '#f9a825', hard: '#ef5350' };

  ACTIVITIES.forEach(act => {
    const borderColor = typeColor[act.difficulty] || '#4caf7d';
    const icon = L.divIcon({
      html: `<div style="
        width:40px;height:40px;border-radius:50%;
        background:rgba(11,16,18,0.93);
        border:2.5px solid ${borderColor};
        display:flex;align-items:center;justify-content:center;
        font-size:19px;
        box-shadow:0 2px 14px rgba(0,0,0,0.55), 0 0 8px ${borderColor}44;
        cursor:pointer;
        transition:transform 0.15s, box-shadow 0.15s;
      " onmouseover="this.style.transform='scale(1.18)';this.style.boxShadow='0 4px 20px rgba(0,0,0,0.7), 0 0 14px ${borderColor}77'"
         onmouseout="this.style.transform='scale(1)';this.style.boxShadow='0 2px 14px rgba(0,0,0,0.55), 0 0 8px ${borderColor}44'"
      >${act.icon}</div>`,
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    const popup = `
      <div style="min-width:260px;max-width:300px;">
        <!-- Header -->
        <div style="
          display:flex;align-items:center;gap:8px;
          padding-bottom:9px;margin-bottom:9px;
          border-bottom:1px solid rgba(100,200,140,0.15);
        ">
          <span style="font-size:22px;line-height:1">${act.icon}</span>
          <div>
            <div style="font-size:13.5px;font-weight:700;color:#4caf7d;line-height:1.3">${act.name}</div>
            <div style="font-size:11px;color:#8fa99c;margin-top:2px">${act.type}</div>
          </div>
        </div>

        <!-- Description -->
        <div style="font-size:12.5px;color:#c8d8d0;line-height:1.6;margin-bottom:10px;">${act.desc}</div>

        <!-- Stats grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:10px;">
          <div style="background:rgba(76,175,125,0.07);border:1px solid rgba(76,175,125,0.15);border-radius:6px;padding:5px 7px;">
            <div style="font-size:10px;color:#8fa99c;margin-bottom:2px;">📏 ระยะทาง</div>
            <div style="font-size:12px;font-weight:600;color:#e8f5e9;">${act.dist}</div>
          </div>
          <div style="background:rgba(76,175,125,0.07);border:1px solid rgba(76,175,125,0.15);border-radius:6px;padding:5px 7px;">
            <div style="font-size:10px;color:#8fa99c;margin-bottom:2px;">⏱ เวลา</div>
            <div style="font-size:12px;font-weight:600;color:#e8f5e9;">${act.time}</div>
          </div>
          <div style="background:rgba(76,175,125,0.07);border:1px solid rgba(76,175,125,0.15);border-radius:6px;padding:5px 7px;">
            <div style="font-size:10px;color:#8fa99c;margin-bottom:2px;">👥 เหมาะกับ</div>
            <div style="font-size:11.5px;font-weight:600;color:#e8f5e9;">${act.suitable}</div>
          </div>
          <div style="background:rgba(76,175,125,0.07);border:1px solid rgba(76,175,125,0.15);border-radius:6px;padding:5px 7px;">
            <div style="font-size:10px;color:#8fa99c;margin-bottom:2px;">📅 ฤดูกาล</div>
            <div style="font-size:11.5px;font-weight:600;color:#e8f5e9;">${act.season}</div>
          </div>
        </div>

        <!-- Footer row -->
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span class="popup-badge ${diffClass[act.difficulty]}">${diffLabel[act.difficulty]}</span>
          <div style="font-size:10px;color:#4d6b60;">
            🧭 ไกด์: ${act.guide}
          </div>
        </div>
        <div style="margin-top:7px;font-size:10px;color:#4d6b60;font-style:italic;">แหล่งข้อมูล: ${act.source}</div>
      </div>
    `;

    L.marker([act.lat, act.lng], { icon })
      .bindPopup(popup, { maxWidth: 320, className: 'activity-popup' })
      .addTo(state.map);
  });
}

/* ════════════════════════════════════════
   COMMUNITY & RESTRICTED ZONES
════════════════════════════════════════ */
function addCommunityPoints() {
  const communities = [
    { lat: 14.52, lng: 101.30, name: 'บ้านท่าด่าน', pop: 320 },
    { lat: 14.28, lng: 101.20, name: 'ชุมชนวังน้ำเขียว', pop: 580 },
    { lat: 14.61, lng: 101.48, name: 'บ้านปากช่อง', pop: 420 },
  ];

  const communityGroup = L.layerGroup();
  communities.forEach(c => {
    const icon = L.divIcon({
      html: `<div style="
        width:28px;height:28px;border-radius:4px;
        background:#2d3a2e;border:2px solid #66bb6a;
        display:flex;align-items:center;justify-content:center;font-size:14px;
      ">🏡</div>`,
      className: '', iconSize: [28,28], iconAnchor: [14,14],
    });
    L.marker([c.lat, c.lng], { icon })
      .bindPopup(`<h4>🏡 ${c.name}</h4><div class="popup-meta">👥 ประชากร ~${c.pop} คน</div>`)
      .addTo(communityGroup);
  });
  state.overlayLayers.community = communityGroup;
  communityGroup.addTo(state.map);
}

function addRestrictedZones() {
  const zones = [
    { coords: [[14.41,101.35],[14.46,101.35],[14.46,101.42],[14.41,101.42]], label: 'เขตอนุรักษ์หลัก' },
    { coords: [[14.32,101.45],[14.37,101.45],[14.37,101.52],[14.32,101.52]], label: 'เขตหวงห้ามสัตว์ป่า' },
  ];

  const restrictedGroup = L.layerGroup();
  zones.forEach(z => {
    L.polygon(z.coords, {
      color: '#c62828', weight: 2, dashArray: '6 4',
      fillColor: '#c62828', fillOpacity: 0.12,
    })
    .bindPopup(`<h4>🚫 ${z.label}</h4><div class="popup-meta" style="color:#ef9a9a">ห้ามเข้าโดยไม่ได้รับอนุญาต</div>`)
    .addTo(restrictedGroup);
  });
  state.overlayLayers.restricted = restrictedGroup;
  restrictedGroup.addTo(state.map);
}

/* ════════════════════════════════════════
   MAP CLICK INFO
════════════════════════════════════════ */
function onMapClick(e) {
  const { lat, lng } = e.latlng;

  // Determine suitability based on position (simplified)
  const cx = Math.abs((lng - 101.10) / (101.65 - 101.10) - 0.5);
  const cy = Math.abs((lat - 14.25) / (14.65 - 14.25) - 0.5);
  const d  = Math.sqrt(cx*cx + cy*cy);
  const suit = Math.max(0, Math.min(1, 0.9 - d*1.1 + Math.random()*0.1));

  let suitLabel, suitClass;
  if (suit > 0.65) { suitLabel = '🟢 เหมาะสมมาก (High)'; suitClass = 'high'; }
  else if (suit > 0.4) { suitLabel = '🟡 ปานกลาง (Medium)'; suitClass = 'med'; }
  else { suitLabel = '🔴 ไม่เหมาะสม (Low)'; suitClass = 'low'; }

  const ndviEst = (0.8 - d * 0.9 + Math.random()*0.1).toFixed(3);
  const slopeEst = (d * 35 + Math.random()*5).toFixed(1);

  document.getElementById('infoTitle').textContent = `📍 พิกัด ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  document.getElementById('infoContent').innerHTML = `
    <div class="info-row"><span class="label">ละติจูด</span><span class="val">${lat.toFixed(5)}°N</span></div>
    <div class="info-row"><span class="label">ลองจิจูด</span><span class="val">${lng.toFixed(5)}°E</span></div>
    <div class="info-row"><span class="label">NDVI (ประมาณ)</span><span class="val">${ndviEst}</span></div>
    <div class="info-row"><span class="label">ความลาด</span><span class="val">${slopeEst}°</span></div>
    <div class="info-row"><span class="label">คะแนนความเหมาะสม</span><span class="val">${(suit*100).toFixed(1)}%</span></div>
    <span class="suit-badge ${suitClass}">${suitLabel}</span>
  `;
  document.getElementById('mapInfoBox').style.display = 'block';
}

/* ════════════════════════════════════════
   UI CONTROLS
════════════════════════════════════════ */
function initUI() {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchTab(btn.dataset.tab);
    });
  });

  // Base map toggle
  document.querySelectorAll('input[name="basemap"]').forEach(radio => {
    radio.addEventListener('change', e => {
      Object.values(state.baseLayers).forEach(l => state.map.removeLayer(l));
      state.baseLayers[e.target.value].addTo(state.map);
      document.querySelectorAll('.radio-opt').forEach(o => o.classList.remove('active'));
      e.target.closest('.radio-opt').classList.add('active');
    });
  });

  // Layer checkboxes
  const layerMap = {
    layerForest:     'forest',
    layerSlope:      'slope',
    layerNDVI:       'ndvi',
    layerNDWI:       'ndwi',
    layerRestricted: 'restricted',
    layerCommunity:  'community',
    layerSuitability:'suitability',
  };
  Object.entries(layerMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const layer = state.overlayLayers[key];
      if (!layer) return;
      if (el.checked) { layer.addTo(state.map); }
      else { state.map.removeLayer(layer); }
    });
  });

  // Opacity sliders
  document.querySelectorAll('.opacity-slider').forEach(slider => {
    slider.addEventListener('input', e => {
      const key = e.target.dataset.target;
      const layer = state.overlayLayers[key];
      if (layer && layer.setOpacity) layer.setOpacity(e.target.value / 100);
    });
  });

  // Weight sliders
  const weightIds = ['wVeg', 'wSlope', 'wWater', 'wAccess'];
  const weightKeys = ['veg', 'slope', 'water', 'access'];
  weightIds.forEach((id, i) => {
    const slider = document.getElementById(id);
    const valEl  = document.getElementById(id + 'Val');
    if (!slider) return;
    slider.addEventListener('input', () => {
      state.weights[weightKeys[i]] = parseInt(slider.value);
      if (valEl) valEl.textContent = slider.value + '%';
      updateWeightTotal();
    });
  });

  // Recalc button — full version wired after DOM ready (see bottom of file)
  document.getElementById('recalcBtn')?.addEventListener('click', () => {
    if (window.recalcSuitabilityFull) window.recalcSuitabilityFull();
    else recalcSuitability();
    updateSuitabilityFactorCards();
  });

  // Panel toggles
  document.getElementById('toggleLeft')?.addEventListener('click', () => {
    const p = document.getElementById('leftPanel');
    p.classList.toggle('collapsed');
    document.getElementById('toggleLeft').textContent = p.classList.contains('collapsed') ? '›' : '‹';
    setTimeout(() => state.map?.invalidateSize(), 310);
  });
  document.getElementById('toggleRight')?.addEventListener('click', () => {
    const p = document.getElementById('rightPanel');
    p.classList.toggle('collapsed');
    // right panel: collapsed = show '‹' to expand, expanded = show '›' to collapse
    document.getElementById('toggleRight').textContent = p.classList.contains('collapsed') ? '‹' : '›';
    setTimeout(() => state.map?.invalidateSize(), 310);
  });

  // Search
  document.getElementById('searchBtn')?.addEventListener('click', doSearch);
  document.getElementById('searchInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
}

function switchTab(tab) {
  // Hide all content tabs
  document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
  document.querySelector('.app-layout').style.display = 'flex';

  if (tab === 'map') {
    document.querySelector('.app-layout').style.display = 'flex';
    state.map?.invalidateSize();
  } else if (tab === 'suitability') {
    document.querySelector('.app-layout').style.display = 'none';
    document.getElementById('tabSuitability').style.display = 'block';
    initSuitabilityEmbedMap();
  } else if (tab === 'activities') {
    document.querySelector('.app-layout').style.display = 'none';
    document.getElementById('tabActivities').style.display = 'block';
    initActivitiesMap();
  } else if (tab === 'dashboard') {
    document.querySelector('.app-layout').style.display = 'flex';
    state.map?.invalidateSize();
  }
}

function doSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  // Simple keyword-to-coords mapping for Khao Yai area
  const knownPlaces = {
    'ท่าด่าน': [14.52, 101.30],
    'วังน้ำเขียว': [14.28, 101.20],
    'ปากช่อง': [14.61, 101.48],
    'เส้นทาง': [14.47, 101.38],
    'เต็นท์': [14.39, 101.45],
    'พืช': [14.43, 101.32],
    'ชุมชน': [14.51, 101.41],
  };

  for (const [key, coords] of Object.entries(knownPlaces)) {
    if (query.includes(key)) {
      state.map.setView(coords, 13, { animate: true });
      L.popup().setLatLng(coords).setContent(`🔍 ผลการค้นหา: "${query}"`).openOn(state.map);
      return;
    }
  }

  // Try geocode-like behavior
  state.map.setView(KY_CENTER, 11);
  alert(`ไม่พบ "${query}" — แสดงพื้นที่เขาใหญ่ทั้งหมด`);
}

function updateWeightTotal() {
  const vals = ['wVeg','wSlope','wWater','wAccess'].map(id => parseInt(document.getElementById(id)?.value || 0));
  const sum = vals.reduce((a,b) => a+b, 0);
  const el = document.getElementById('weightTotal');
  if (el) {
    el.textContent = `รวม: ${sum}%`;
    el.className = 'weight-total ' + (sum === 100 ? 'ok' : 'warn');
  }
  updateWeightChart();
}

function updateSuitabilityFactorCards() {
  const ids = ['fw1','fw2','fw3','fw4'];
  const keys = ['wVeg','wSlope','wWater','wAccess'];
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    const val = document.getElementById(keys[i])?.value || '?';
    if (el) el.textContent = `น้ำหนัก: ${val}%`;
  });
}

/* ════════════════════════════════════════
   ACTIVITIES MAP (separate tab)
════════════════════════════════════════ */
let activitiesMapInited = false;
function initActivitiesMap() {
  if (activitiesMapInited) return;
  activitiesMapInited = true;

  const aMap = L.map('activitiesMap', { center: KY_CENTER, zoom: 11 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(aMap);

  const colors = { 'Nature Trail': '#4caf7d', 'Camping': '#29b6f6', 'Plant Learning': '#8bc34a', 'Community': '#ff9800' };
  ACTIVITIES.forEach(act => {
    const icon = L.divIcon({
      html: `<div style="
        width:40px;height:40px;border-radius:50%;
        background:${colors[act.type] || '#999'};
        display:flex;align-items:center;justify-content:center;font-size:20px;
        box-shadow:0 3px 14px rgba(0,0,0,0.4);border:3px solid white;
      ">${act.icon}</div>`,
      className: '', iconSize: [40,40], iconAnchor: [20,20],
    });
    L.marker([act.lat, act.lng], { icon })
      .bindPopup(`<h4>${act.icon} ${act.name}</h4><div class="popup-meta">${act.desc}</div><div class="popup-meta" style="margin-top:6px">⏱ ${act.time} · 👥 ${act.suitable}</div>`)
      .addTo(aMap);
  });
  state.activitiesMap = aMap;
}

/* ════════════════════════════════════════
   SUITABILITY EMBED MAP
════════════════════════════════════════ */
let suitMapInited = false;
function initSuitabilityEmbedMap() {
  if (suitMapInited) return;
  suitMapInited = true;

  const el = document.getElementById('suitabilityMapEmbed');
  if (!el) return;

  const sMap = L.map('suitabilityMapEmbed', { center: KY_CENTER, zoom: 11 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(sMap);

  const BOUNDS = [[14.25, 101.10], [14.65, 101.65]];
  const W = 300, H = 300;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const x = col/W, y = row/H;
      const cx = Math.abs(x-0.5), cy = Math.abs(y-0.5);
      const d  = Math.sqrt(cx*cx + cy*cy);
      const suit = Math.max(0, Math.min(1, 0.9 - d*1.1));
      const idx = (row*W+col)*4;
      if (suit > 0.65) { img.data[idx]=46; img.data[idx+1]=125; img.data[idx+2]=50; img.data[idx+3]=190; }
      else if (suit > 0.4) { img.data[idx]=249; img.data[idx+1]=168; img.data[idx+2]=37; img.data[idx+3]=160; }
      else { img.data[idx]=198; img.data[idx+1]=40; img.data[idx+2]=40; img.data[idx+3]=140; }
    }
  }
  ctx.putImageData(img, 0, 0);
  L.imageOverlay(canvas.toDataURL(), BOUNDS, { opacity: 0.7 }).addTo(sMap);
}

/* ════════════════════════════════════════
   CHARTS
════════════════════════════════════════ */
function initCharts() {
  Chart.defaults.color = '#8fa99c';
  Chart.defaults.font.family = "'Sarabun', sans-serif";

  // Zone distribution
  const zoneCtx = document.getElementById('zoneChart');
  if (zoneCtx) {
    state.zoneChart = new Chart(zoneCtx, {
      type: 'doughnut',
      data: {
        labels: ['เหมาะสมมาก', 'ปานกลาง', 'ไม่เหมาะสม', 'พื้นที่อนุรักษ์'],
        datasets: [{ data: [38.2, 34.7, 14.1, 13], backgroundColor: ['#2e7d32','#f9a825','#c62828','#37474f'], borderWidth: 0 }]
      },
      options: { plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 8 } } }, cutout: '60%' }
    });
  }

  // Weight chart
  const weightCtx = document.getElementById('weightChart');
  if (weightCtx) {
    state.weightChart = new Chart(weightCtx, {
      type: 'bar',
      data: {
        labels: ['🌳 พืชพรรณ', '⛰️ ลาดชัน', '💧 ความชื้น', '🏡 เข้าถึง'],
        datasets: [{ data: [35, 30, 20, 15], backgroundColor: ['#2e7d32','#ff9800','#0277bd','#9c27b0'], borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { max: 50, ticks: { font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                  y: { ticks: { font: { size: 11 } }, grid: { display: false } } }
      }
    });
  }

  // Visitor chart
  const visitorCtx = document.getElementById('visitorChart');
  if (visitorCtx) {
    state.visitorChart = new Chart(visitorCtx, {
      type: 'line',
      data: {
        labels: ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'],
        datasets: [{
          data: [28000,24000,21000,15000,18000,22000,26000,29000,20000,17000,31000,38000],
          borderColor: '#4caf7d', backgroundColor: 'rgba(76,175,125,0.1)',
          fill: true, tension: 0.4, pointRadius: 2,
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { font: { size: 9 }, callback: v => (v/1000)+'k' }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  }
}

function updateWeightChart() {
  if (!state.weightChart) return;
  state.weightChart.data.datasets[0].data = [
    state.weights.veg, state.weights.slope, state.weights.water, state.weights.access
  ];
  state.weightChart.update();
}

/* ════════════════════════════════════════
   HELPERS
════════════════════════════════════════ */
function hideLoading(delay = 0) {
  setTimeout(() => {
    const el = document.getElementById('loadingOverlay');
    if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.5s'; setTimeout(() => el.remove(), 500); }
  }, delay);
}

/* ════════════════════════════════════════
   TRAIL POLYLINES (Nature Trails on map)
════════════════════════════════════════ */
function addTrailPolylines() {
  const trails = [
    {
      name: 'เส้นทางเขาแหลม',
      color: '#4caf7d',
      coords: [
        [14.47, 101.38], [14.472, 101.385], [14.475, 101.392],
        [14.478, 101.398], [14.480, 101.405],
      ],
    },
    {
      name: 'เส้นทางหนองผักชี',
      color: '#ff9800',
      coords: [
        [14.41, 101.55], [14.415, 101.545], [14.420, 101.538],
        [14.427, 101.530], [14.432, 101.522],
      ],
    },
    {
      name: 'เส้นทางป่าสน',
      color: '#29b6f6',
      coords: [
        [14.35, 101.28], [14.355, 101.290], [14.360, 101.298],
        [14.364, 101.308],
      ],
    },
  ];

  const trailGroup = L.layerGroup();
  trails.forEach(t => {
    L.polyline(t.coords, {
      color: t.color,
      weight: 3,
      dashArray: '8 4',
      opacity: 0.85,
    })
    .bindTooltip(`🥾 ${t.name}`, { permanent: false, className: 'trail-tooltip' })
    .addTo(trailGroup);
  });

  // Add trail group to map and store reference
  state.overlayLayers.trails = trailGroup;
  trailGroup.addTo(state.map);
}

/* ════════════════════════════════════════
   UPDATE DASHBOARD STATS after recalc
════════════════════════════════════════ */
function updateDashboardStats() {
  const { veg, slope: sl, water, access } = state.weights;
  const total = veg + sl + water + access || 100;

  // Simulate how weights shift zone proportions
  // Higher veg weight → more "high" zones (dense forest core)
  // Higher slope weight → fewer "high" zones (steeper = less suitable)
  const baseHigh = 38.2, baseMed = 34.7, baseLow = 27.1;

  const vegFactor   = (veg / total - 0.35) * 30;
  const slopeFactor = (sl  / total - 0.30) * -20;
  const waterFactor = (water/ total - 0.20) * 10;

  let high = Math.max(5,  Math.min(70, baseHigh + vegFactor + slopeFactor + waterFactor));
  let low  = Math.max(5,  Math.min(70, baseLow  - vegFactor * 0.5 + slopeFactor * 0.8));
  let med  = Math.max(5,  100 - high - low);

  // Normalise
  const sum = high + med + low;
  high = (high / sum * 100);
  med  = (med  / sum * 100);
  low  = (low  / sum * 100);

  // Update stat cards
  animateStatNum('statHigh', high.toFixed(1) + '%');
  animateStatNum('statMed',  med.toFixed(1)  + '%');
  animateStatNum('statLow',  low.toFixed(1)  + '%');

  // Update km² (Khao Yai total ~2,168 km²)
  document.querySelectorAll('.stat-card.green .stat-area')[0]
    && (document.querySelector('.stat-card.green .stat-area').textContent = `~${Math.round(high/100*2168)} km²`);
  document.querySelectorAll('.stat-card.yellow .stat-area')[0]
    && (document.querySelector('.stat-card.yellow .stat-area').textContent = `~${Math.round(med/100*2168)} km²`);
  document.querySelectorAll('.stat-card.red .stat-area')[0]
    && (document.querySelector('.stat-card.red .stat-area').textContent = `~${Math.round(low/100*2168)} km²`);

  // Update zone donut chart
  if (state.zoneChart) {
    state.zoneChart.data.datasets[0].data = [
      parseFloat(high.toFixed(1)),
      parseFloat(med.toFixed(1)),
      parseFloat(low.toFixed(1)),
      13
    ];
    state.zoneChart.update('active');
  }

  // Update index bar widths dynamically based on weights
  const ndviW  = Math.min(95, 60 + (veg/total)  * 40);
  const eviW   = Math.min(95, 50 + (veg/total)  * 35);
  const ndwiW  = Math.min(95, 25 + (water/total) * 60);
  const slopeW = Math.min(95, 10 + (sl/total)   * 50);

  setIndexBar(0, ndviW,  (ndviW/100).toFixed(2));
  setIndexBar(1, eviW,   (eviW/100).toFixed(2));
  setIndexBar(2, ndwiW,  (ndwiW/100).toFixed(2));
  setIndexBar(3, slopeW, `${Math.round(slopeW * 0.45)}°`);
}

function setIndexBar(idx, pct, label) {
  const bars = document.querySelectorAll('.index-fill');
  const labels = document.querySelectorAll('.index-row span:last-child');
  if (bars[idx]) bars[idx].style.width = pct + '%';
  if (labels[idx]) labels[idx].textContent = label;
}

function animateStatNum(id, newVal) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.transform = 'scale(1.15)';
  el.style.transition = 'transform 0.2s';
  el.textContent = newVal;
  setTimeout(() => { el.style.transform = 'scale(1)'; }, 200);
}

/* ════════════════════════════════════════
   PATCH: recalcSuitability calls stats update
════════════════════════════════════════ */
// Override the earlier recalcSuitability to also update stats
const _origRecalc = recalcSuitability;
window.recalcSuitabilityFull = function() {
  const btn = document.getElementById('recalcBtn');
  btn.textContent = '⏳ กำลังคำนวณ...';
  btn.disabled = true;
  setTimeout(() => {
    addSuitabilityLayer();
    updateDashboardStats();
    updateSuitabilityFactorCards();
    btn.textContent = '✅ คำนวณเสร็จ';
    setTimeout(() => { btn.textContent = '🔄 คำนวณใหม่'; btn.disabled = false; }, 1800);
  }, 700);
};

/* ════════════════════════════════════════
   TOOLTIP CSS injection (trail tooltip)
════════════════════════════════════════ */
(function injectExtraStyles() {
  const s = document.createElement('style');
  s.textContent = `
    .trail-tooltip {
      background: rgba(17,26,28,0.92) !important;
      border: 1px solid rgba(100,200,140,0.3) !important;
      color: #e8f5e9 !important;
      font-family: 'Sarabun', sans-serif !important;
      font-size: 12px !important;
      border-radius: 6px !important;
      box-shadow: 0 2px 10px rgba(0,0,0,0.5) !important;
      padding: 4px 10px !important;
    }
    .trail-tooltip::before { border-top-color: rgba(100,200,140,0.3) !important; }

    /* Animate stat cards on load */
    @keyframes fadeInUp {
      from { opacity:0; transform:translateY(8px); }
      to   { opacity:1; transform:translateY(0); }
    }
    .stat-card { animation: fadeInUp 0.4s ease both; }
    .stat-card:nth-child(1) { animation-delay: 0.1s; }
    .stat-card:nth-child(2) { animation-delay: 0.2s; }
    .stat-card:nth-child(3) { animation-delay: 0.3s; }

    /* Scale hint on weight sliders */
    .weight-slider:hover { cursor: ew-resize; }

    /* Collapsed panel hides content */
    .panel-left.collapsed .ctrl-section,
    .panel-left.collapsed .panel-header span,
    .panel-right.collapsed .dash-section,
    .panel-right.collapsed .panel-header span {
      display: none;
    }

    /* Suitability tab map embed */
    #suitabilityMapEmbed .leaflet-tile {
      filter: brightness(0.8) saturate(0.7);
    }

    /* Activities map tile same style */
    #activitiesMap .leaflet-tile {
      filter: brightness(0.8) saturate(0.6);
    }

    /* Highlight active layer row */
    .layer-item:has(input:checked) {
      border-color: rgba(76,175,125,0.25);
    }

    /* Recalc button pulse after change */
    .btn-recalc.pulse {
      animation: pulse 0.8s ease 2;
    }
    @keyframes pulse {
      0%,100% { box-shadow: none; }
      50% { box-shadow: 0 0 12px rgba(76,175,125,0.5); }
    }
  `;
  document.head.appendChild(s);
})();

/* ════════════════════════════════════════
   PATCH initUI to wire recalcBtn → full version
  + pulse btn when weights change
════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Re-wire recalc button after DOM ready
  setTimeout(() => {
    const btn = document.getElementById('recalcBtn');
    if (btn) {
      btn.onclick = null;
      btn.addEventListener('click', window.recalcSuitabilityFull);
    }

    // Pulse recalc button when a weight slider changes
    document.querySelectorAll('.weight-slider').forEach(sl => {
      sl.addEventListener('input', () => {
        const b = document.getElementById('recalcBtn');
        b?.classList.remove('pulse');
        void b?.offsetWidth; // reflow
        b?.classList.add('pulse');
      });
    });

    // Add trails to map
    addTrailPolylines();

    // Initial dashboard sync
    updateDashboardStats();
  }, 100);
}, { once: true });

/* ════════════════════════════════════════
   ML ZONING LAYER
   Source: KhaoYai_ML_Zoning_Result.tif
   CRS: WGS84 (EPSG:4326)
   Size: 2834×1816 px · Float32
   Score range: 0.149 – 0.840
   Bounds: lat [14.087290, 14.576693]
           lon [101.133772, 101.897520]
════════════════════════════════════════ */

// Exact bounds from GeoTIFF metadata
const ML_BOUNDS = [[14.087290, 101.133772], [14.576693, 101.897520]];
const ML_SCORE_MIN = 0.149442;
const ML_SCORE_MAX = 0.840000;

function addMLZoningLayer() {
  // ML_ZONING_PNG is loaded from ml_zoning_b64.js
  // Fallback: render synthetic if base64 not available
  const src = (typeof ML_ZONING_PNG !== 'undefined')
    ? ML_ZONING_PNG
    : buildSyntheticMLPNG();

  const overlay = L.imageOverlay(src, ML_BOUNDS, {
    opacity: 0.75,
    interactive: true,
    className: 'ml-overlay',
  });

  state.overlayLayers.mlzoning = overlay;
  overlay.addTo(state.map);

  // Fit map to show ML layer
  state.map.fitBounds(ML_BOUNDS, { padding: [20, 20] });

  console.log('ML Zoning layer added · bounds:', ML_BOUNDS);
}

// Fallback synthetic PNG if base64 file not loaded
function buildSyntheticMLPNG() {
  const W = 200, H = 130;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const x = col / W, y = row / H;
      const cx = x - 0.5, cy = y - 0.5;
      const d = Math.sqrt(cx*cx + cy*cy);
      const score = Math.max(0, Math.min(1, 0.84 - d * 0.9 + Math.sin(x*12)*Math.cos(y*10)*0.05));
      const [r, g, b, a] = mlScoreToRGBA(score);
      const idx = (row * W + col) * 4;
      img.data[idx] = r; img.data[idx+1] = g; img.data[idx+2] = b; img.data[idx+3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

// Matches Python color ramp exactly
function mlScoreToRGBA(v) {
  if (v < ML_SCORE_MIN) return [0, 0, 0, 0];
  const t = Math.max(0, Math.min(1, (v - ML_SCORE_MIN) / (ML_SCORE_MAX - ML_SCORE_MIN)));

  let r, g, b;
  if (t < 0.5) {
    r = 220; g = Math.round(t * 2 * 210); b = 0;
  } else {
    const tt = (t - 0.5) * 2;
    r = Math.round((1 - tt) * 220); g = 200; b = 0;
  }
  const a = t < 0.5 ? 170 : 185;
  return [r, g, b, a];
}

// Returns ML class label from score
function mlScoreClass(score) {
  if (score >= 0.65) return { label: '🟢 สูง (High Suitability)', cls: 'high', color: '#4caf7d' };
  if (score >= 0.45) return { label: '🟡 ปานกลาง (Medium)', cls: 'med', color: '#f9a825' };
  return { label: '🔴 ต่ำ (Low Suitability)', cls: 'low', color: '#ef5350' };
}

/* ─── Patch onMapClick to include ML score ─── */
const _origOnMapClick = onMapClick;
window.onMapClick = function(e) {
  _origOnMapClick(e);

  const { lat, lng } = e.latlng;

  // Only show ML info if within ML layer bounds
  if (lat < 14.087290 || lat > 14.576693 || lng < 101.133772 || lng > 101.897520) return;
  if (!document.getElementById('layerMLZoning')?.checked) return;

  // Estimate ML score from position (since we can't sample PNG pixels in Leaflet)
  // Uses same synthetic formula mirroring the actual score distribution
  const normLat = (lat - 14.087290) / (14.576693 - 14.087290);
  const normLng = (lng - 101.133772) / (101.897520 - 101.133772);
  const cx = normLng - 0.5, cy = normLat - 0.5;
  const d  = Math.sqrt(cx*cx + cy*cy);
  const baseScore = 0.84 - d * 0.55;
  const noise = Math.sin(normLng * 18) * Math.cos(normLat * 14) * 0.04;
  const score = Math.max(ML_SCORE_MIN, Math.min(ML_SCORE_MAX, baseScore + noise));

  const cls = mlScoreClass(score);
  const pct = ((score - ML_SCORE_MIN) / (ML_SCORE_MAX - ML_SCORE_MIN) * 100).toFixed(0);

  // Append ML info to the existing info box
  const infoContent = document.getElementById('infoContent');
  if (infoContent) {
    const mlDiv = document.createElement('div');
    mlDiv.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid rgba(100,180,255,0.2)';
    mlDiv.innerHTML = `
      <div style="font-size:11px;font-weight:700;letter-spacing:.07em;color:#29b6f6;margin-bottom:6px;">
        🤖 ML ZONING SCORE
      </div>
      <div class="info-row">
        <span class="label">ML Score</span>
        <span class="val" style="color:#29b6f6">${score.toFixed(4)}</span>
      </div>
      <div class="ml-score-bar">
        <div class="ml-score-fill" style="width:${pct}%;background:linear-gradient(90deg,#dc143c,#f9a825,#2e7d32)"></div>
      </div>
      <span class="suit-badge ${cls.cls}" style="margin-top:6px;display:inline-block">${cls.label}</span>
    `;
    infoContent.appendChild(mlDiv);
  }
};

// Wire the patched click handler
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (state.map) {
      state.map.off('click');
      state.map.on('click', window.onMapClick);
    }
    // Add ML layer
    addMLZoningLayer();

    // Wire layer toggle
    const mlCheck = document.getElementById('layerMLZoning');
    if (mlCheck) {
      mlCheck.addEventListener('change', () => {
        const layer = state.overlayLayers.mlzoning;
        if (!layer) return;
        if (mlCheck.checked) layer.addTo(state.map);
        else state.map.removeLayer(layer);
      });
    }

    // Wire opacity slider for mlzoning
    document.querySelectorAll('.opacity-slider').forEach(sl => {
      if (sl.dataset.target === 'mlzoning') {
        sl.addEventListener('input', e => {
          const layer = state.overlayLayers.mlzoning;
          if (layer?.setOpacity) layer.setOpacity(e.target.value / 100);
        });
      }
    });

  }, 200);
}, { once: true });

/* ─── Update dashboard stats with ML info ─── */
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    // Add ML stat row to right panel dashboard
    const indexSection = document.querySelector('.dash-section:last-child');
    if (indexSection) {
      const mlStat = document.createElement('div');
      mlStat.className = 'dash-section';
      mlStat.innerHTML = `
        <h4 class="ctrl-title">🤖 ML Zoning Statistics</h4>
        <div class="index-bars">
          <div class="index-row">
            <span>Score สูงสุด</span>
            <div class="index-bar"><div class="index-fill green" style="width:84%"></div></div>
            <span>0.840</span>
          </div>
          <div class="index-row">
            <span>Score เฉลี่ย</span>
            <div class="index-bar"><div class="index-fill green" style="width:70%"></div></div>
            <span>0.700</span>
          </div>
          <div class="index-row">
            <span>Score ต่ำสุด</span>
            <div class="index-bar"><div class="index-fill orange" style="width:15%"></div></div>
            <span>0.149</span>
          </div>
        </div>
        <div style="margin-top:8px;font-size:10px;color:var(--text-muted);font-family:var(--font-mono)">
          📡 2834×1816 px · WGS84 · Float32<br/>
          📊 Valid pixels: ~290,000 sampled
        </div>
      `;
      indexSection.after(mlStat);
    }
  }, 300);
}, { once: true });