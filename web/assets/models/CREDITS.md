# Credits — 3D people (assets/models/)

All character models and their textures in this folder come from the **Microsoft Rocketbox Avatar Library**.

- Source: https://github.com/microsoft/Microsoft-Rocketbox (branch `master`, files under `Assets/Avatars/`)
- License: **MIT License**, Copyright (c) 2020 Microsoft — read on the repository's `LICENSE.md` and the repository metadata (`license: mit`) on 2026-11-17.
  The full license text is reproduced at the end of this file ("Microsoft Rocketbox license"). MIT allows free commercial use, modification and redistribution,
  provided the copyright notice and permission notice are included — keep this file with the game.
- The characters are fictional avatars made by the Rocketbox studio (no scanned celebrities, no characters from other games).
- Downloaded without an account from `raw.githubusercontent.com` (only the folders listed below, not the whole repository).

| Game id | Rocketbox avatar | Files used | What was changed |
|---|---|---|---|
| `kai` (the lead) | `Adults/Male_Adult_09` (m017) | `Export/Male_Adult_09.fbx`, `Textures/m017_body_color/normal`, `m017_head_color/normal`, `m017_opacity_color` | Body texture recoloured in `tools/mdl.html` (`MD.heroTex`): the printed navy T-shirt became a plain heather-grey tee (the generated knit photo `assets/tex/fabric_tee_grey.jpg` laid over it), light jeans → dark indigo, brown trainers → white, a forearm tattoo painted out |
| `m01` | `Adults/Male_Adult_01` (m002) | fbx + body/head color & normal + opacity | resized only |
| `m10` | `Adults/Male_Adult_10` (m024) | same | resized only |
| `m12` | `Adults/Male_Adult_12` (m007) | fbx + body/head color & normal | resized only |
| `m16` | `Adults/Male_Adult_16` (m019) | same | resized only |
| `f03` | `Adults/Female_Adult_03` (f003) | fbx + body/head color & normal + opacity | resized only |
| `f08` | `Adults/Female_Adult_08` (f008) | same | resized only |
| `fp1` | `Adults/Female_Party_01` (f010) | same | resized only |
| `sf1` | `Professions/Sports_Female_01` (f021) | fbx + body/head color & normal | resized only |
| `sm1` | `Professions/Sports_Male_01` (m021) | same | resized only |
| `m06` | `Adults/Male_Adult_06` (m011) | fbx + body/head color & normal + opacity | resized only |
| `f17` | `Adults/Female_Adult_17` (f006) | same | resized only |
| `fp2` | `Adults/Female_Party_02` (f022) | same | resized only |
| `sm4` | `Professions/Sports_Male_04` (m026) | fbx + body/head color & normal | resized only |
| `pol` | `Professions/Police_Male_03` (m172) | fbx + body/head/equipment color & normal + pistol color | resized only (the uniform reads POLICE on chest, back and cap band; no real force's insignia) |

Processing (no downloaded program was run): the FBX files were read in a browser page with three.js r128's own `FBXLoader` and written out as `.glb`
(skeleton + skinned mesh, vertices welded, one draw group per material, no textures) with `GLTFExporter` — `tools/mdl.html`. Textures were converted from TGA
and resized with ffmpeg (body 1024² — the lead 2048²; head/face 1024² — the lead 2048²; normal maps 1024²; hair cards 1024×512 colour + alpha).

Raw source files: the original downloads (FBX + TGA, about 870 MB) are **not** kept in the project any more (moved out on 2026-11-17). They can be
downloaded again at any time from the source repository above, e.g. `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/Adults/Male_Adult_09/Export/Male_Adult_09.fbx`
and the matching `Textures/*.tga` (same path pattern for every avatar in the table). `tools/mdl.html` expects them under `assets/models/_raw/<Avatar>/`.

Vehicles: no downloaded vehicle models are used; every car, van, bus and bike is generated in code (`js/cnvehicles.js`).

## Microsoft Rocketbox license

```
MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
