/* Vehicle radio. One streaming decoder feeds the existing music mix. */
(() => {
  const stations = window.BTAStations;
  const broadcastStart = performance.now();
  const preference = 'afterglow.radio';
  let station = 0, enabled = true;
  try {
    const saved = JSON.parse(localStorage.getItem(preference));
    if (saved && stations.includes(saved.station)) {
      station = stations.indexOf(saved.station);
      enabled = saved.enabled !== false;
    }
  } catch (_) {}
  let player, label, driving = false, audible = false, blocked = false;
  function display() {
    if (!label) {
      label = document.createElement('aside');
      label.className = 'vc-radio';
      label.innerHTML = '<small>VICE CITY RADIO</small><strong></strong><span>滚轮 ↑ 上一台　↓ 下一台　·　\\ 开关</span>';
      document.body.append(label);
    }
    label.hidden = !driving;
    label.querySelector('strong').textContent = enabled ? stations[station] : '电台已关闭';
  }
  function play() {
    if (!driving || !enabled || !player) return;
    player.play().catch(error => { if (error.name === 'NotAllowedError') blocked = true; });
  }
  function tune() {
    player.src = 'audio/radio/' + encodeURIComponent(stations[station]) + '.mp3';
    blocked = false;
  }
  function retry() {
    if (blocked && audible) { blocked = false; play(); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && player) { player.pause(); audible = false; }
  });
  addEventListener('pointerdown', retry, true);
  function changeStation(direction) {
    if (direction) {
      station = (station + direction + stations.length) % stations.length;
      enabled = true;
      tune();
    } else enabled = !enabled;
    try { localStorage.setItem(preference, JSON.stringify({station: stations[station], enabled})); } catch (_) {}
    if (enabled) play(); else player.pause();
    display();
  }
  function acceptsInput() {
    const game = GT.cngame;
    return driving && audible && !document.hidden && game?.state.mode === 'car' &&
      !game.G.paused && !game.G.cine && !GT.shops?.isOpen && !GT.front?.busy;
  }
  addEventListener('keydown', event => {
    retry();
    if (event.repeat || !['BracketLeft','BracketRight','Backslash'].includes(event.code) || !acceptsInput()) return;
    changeStation(event.code === 'Backslash' ? 0 : event.code === 'BracketRight' ? 1 : -1);
  });
  let wheelDistance = 0, lastWheelTime = 0;
  addEventListener('wheel', event => {
    if (!acceptsInput() || event.ctrlKey || event.metaKey || event.shiftKey ||
        !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const distance = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? innerHeight : 1);
    if (event.timeStamp - lastWheelTime > 200 || wheelDistance * distance < 0) wheelDistance = 0;
    lastWheelTime = event.timeStamp;
    wheelDistance += distance;
    if (Math.abs(wheelDistance) >= 40) {
      changeStation(Math.sign(wheelDistance));
      wheelDistance = 0;
    }
  }, {capture:true, passive:false});
  GT.vehicleRadio = {
    get name() { return stations[station]; },
    get on() { return !!player && !player.paused; },
    update(inCar, active) {
      if (inCar && !player) {
        const mix = GT.audio.rig();
        if (!mix) return;
        player = new Audio();
        player.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(player.duration) && player.duration > 0) player.currentTime = ((performance.now() - broadcastStart) / 1000) % player.duration;
        });
        player.loop = true; player.volume = .48;
        mix.ac.createMediaElementSource(player).connect(mix.musicBus);
        tune();
      }
      if (driving === inCar && audible === active) return;
      driving = inCar; audible = active;
      display();
      label.hidden = !inCar || !active;
      if (active && inCar && enabled) play(); else if (player) player.pause();
    }
  };
})();
