// The sound of the flight, made from one loop of noise: wind over the wings (louder and higher with speed)
// and surf (louder low over the break). No files to load. Browsers only allow sound after a touch or a key,
// so `start` is called from the first one.

export interface Soundscape {
  start(): void;
  setMuted(muted: boolean): void;
  /** `speed` 0 to 1 over the pelican's range, `surf` 0 to 1 for how near the breaking waves are. */
  update(speed: number, surf: number, time: number): void;
}

export function createSoundscape(): Soundscape {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let wind: { filter: BiquadFilterNode; gain: GainNode } | null = null;
  let surf: { filter: BiquadFilterNode; gain: GainNode } | null = null;
  let muted = false;
  return {
    start() {
      if (context) {
        if (context.state === "suspended") void context.resume();
        return;
      }
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      context = new Ctor();
      const length = context.sampleRate * 3;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      // Brown-ish noise: white noise run through a leaky integrator, so it is a rush and not a hiss.
      let last = 0;
      for (let i = 0; i < length; i++) {
        last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
        data[i] = last * 7;
      }
      master = context.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(context.destination);
      const voice = (type: BiquadFilterType, frequency: number, offset: number) => {
        const source = context!.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const filter = context!.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = 0.6;
        const gain = context!.createGain();
        gain.gain.value = 0;
        source.connect(filter).connect(gain).connect(master!);
        source.start(0, offset);
        return { filter, gain };
      };
      wind = voice("bandpass", 600, 0);
      surf = voice("lowpass", 420, 1.3);
    },
    setMuted(value) {
      muted = value;
      if (master && context) master.gain.setTargetAtTime(value ? 0 : 1, context.currentTime, 0.05);
    },
    update(speed, surfNear, time) {
      if (!context || !wind || !surf) return;
      const now = context.currentTime;
      wind.gain.gain.setTargetAtTime(0.05 + 0.35 * speed * speed, now, 0.15);
      wind.filter.frequency.setTargetAtTime(450 + 900 * speed, now, 0.15);
      // The surf swells and falls back like sets coming through.
      const swell = 0.7 + 0.3 * Math.sin(time * 0.65) * Math.sin(time * 0.23 + 1);
      surf.gain.gain.setTargetAtTime((0.12 + 0.5 * surfNear) * swell, now, 0.3);
    },
  };
}
