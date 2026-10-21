/*!
 * Copyright (C) 2023 Lju
 *
 * This file is part of Astra Monitor extension for GNOME Shell.
 * [https://github.com/AstraExt/astra-monitor]
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
export const INTEL_SAMPLE_FLUSH = /^\},?\s*$/;
const INTEL_INTEGRATED_GPU_PCI_ID = '0000:00:02.0';
export function isIntegratedIntelGpu(pciAddress) {
    return pciAddress.toLowerCase() === INTEL_INTEGRATED_GPU_PCI_ID;
}
export function parseIntelGpuSample(data) {
    let result = data.trim();
    if (result.startsWith('['))
        result = result.substring(1).trim();
    if (result.startsWith(','))
        result = result.substring(1).trim();
    if (result.endsWith(','))
        result = result.substring(0, result.length - 1).trim();
    if (!result.startsWith('{'))
        return undefined;
    return JSON.parse(result);
}
export function parseSysfsNumber(content) {
    const value = parseFloat(content.trim());
    if (isNaN(value) || !isFinite(value))
        return undefined;
    return value;
}
export function intelActivityFromRc6(previousResidency, currentResidency, elapsed) {
    const rc6Percent = ((currentResidency - previousResidency) / (elapsed * 1000)) * 100;
    if (rc6Percent < 0)
        return undefined;
    return Math.min(100, Math.max(0, 100 - rc6Percent));
}
export function intelActivity(sample, previousResidency, currentResidency, elapsed) {
    const pipes = [];
    const engines = sample?.engines ?? {};
    for (const name in engines) {
        const busy = engines[name]?.busy;
        if (busy == null || isNaN(busy))
            continue;
        pipes.push({ name, percent: busy });
    }
    if (pipes.length > 0) {
        const render = pipes.find(pipe => pipe.name.startsWith('Render/3D'));
        return {
            GFX: render ? render.percent : Math.max(...pipes.map(pipe => pipe.percent)),
            pipes,
        };
    }
    if (previousResidency == null || currentResidency == null || elapsed <= 0)
        return { pipes };
    const GFX = intelActivityFromRc6(previousResidency, currentResidency, elapsed);
    return GFX == null ? { pipes } : { GFX, pipes };
}
export function intelPower(sample, previousEnergy, currentEnergy, elapsed) {
    const power = sample?.power?.GPU;
    if (power != null && !isNaN(power))
        return { value: parseFloat(power.toFixed(2)), unit: sample?.power?.unit ?? 'W' };
    if (previousEnergy == null || currentEnergy == null || elapsed <= 0)
        return undefined;
    const delta = currentEnergy - previousEnergy;
    if (delta < 0)
        return undefined;
    return { value: parseFloat((delta / 1000000 / elapsed).toFixed(2)), unit: 'W' };
}
export function intelFrequency(sample, curFreq) {
    const frequency = sample?.frequency?.actual ?? parseSysfsNumber(curFreq);
    if (frequency == null || isNaN(frequency))
        return undefined;
    return Math.round(frequency);
}
export function intelVram(sample) {
    const regions = new Map();
    for (const id in sample?.clients) {
        const memory = sample?.clients?.[id]?.memory;
        for (const region in memory) {
            const resident = parseFloat(memory[region]?.resident ?? '');
            if (isNaN(resident))
                continue;
            regions.set(region, (regions.get(region) ?? 0) + resident);
        }
    }
    if (regions.size === 0)
        return undefined;
    let used = 0;
    const list = [];
    for (const [name, value] of regions) {
        used += value;
        list.push({ name, used: value });
    }
    return { used, regions: list };
}
export function parseMemTotal(content) {
    const match = /^MemTotal:\s+(\d+)\s*kB/m.exec(content);
    if (!match)
        return undefined;
    const value = parseInt(match[1], 10);
    if (isNaN(value))
        return undefined;
    return value * 1024;
}
