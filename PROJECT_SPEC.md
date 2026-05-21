# PROJECT SPEC: TACTICAL FPS (Competitive Browser Edition)

## 🎯 Game Intentions & Core Vision
The goal is to create a high-fidelity, server-authoritative 128-tick tactical shooter that runs in the browser. It prioritizes precision, minimalist geometric aesthetics, and extreme responsiveness.
- **Reference:** Valorant/Counter-Strike competitive mechanics.
- **Divergence:** "Spike" is replaced by the "Nuclear Explosive (NUKE)". Visuals are purely neon-geometric for performance and clarity.

## 🧐 Technical Analysis & Parecer
### What went well:
- **Networking:** The 128-tick server-authoritative model with client-side prediction and lag compensation is robust.
- **Sound System:** Procedural WebAudio oscillators allow for zero-latency surface-aware footsteps and combat audio without heavy assets.
- **Renderer:** Pure Canvas2D remains performant even on low-end hardware while maintaining a "premium" look via glow effects and shadows.

### What could be improved (Architectural Debt):
- **State Coupling:** The round state machine is partially in `MatchSystem.ts` and `GameRoom.ts`. This occasionally causes "off-by-one" errors in timers.
- **Event Bus:** Currently using a mix of `socket.emit` and `onEvent` callbacks. A standardized `ProjectEventBus` would make it easier to add new visual effects globally.

## 🧱 Inconsistências Arquiteturais & Dívida Técnica (Análise Profunda)

Esta seção lista comportamentos incompletos, lógicas duplicadas ou sequências confusas identificadas no código que devem ser refatoradas para garantir a escalabilidade do projeto.

### 1. Desconexão entre Predição e Renderização (Client-side)
- **Localização:** `InputSystem.ts` vs `GameRenderer.ts`.
- **Inconsistência:** O `InputSystem` calcula a `predictedPos` (predição do cliente) e realiza a reconciliação com o servidor, mas o `GameRenderer` ignora completamente este valor. O renderizador desenha o jogador local baseado apenas nos snapshots do servidor e no buffer de interpolação.
- **Impacto:** O movimento do jogador local parece ter um atraso (lag) equivalente ao ping, invalidando o propósito da predição de latência zero.

### 2. Timers Frágeis no Sistema de Partida (Server-side)
- **Localização:** `MatchSystem.ts`.
- **Inconsistência:** Transições críticas de estado (como `halftime` e `round_end`) dependem de `setTimeout`.
- **Impacto:** Se o servidor sofrer um stall no loop de eventos ou for reiniciado, esses timers são perdidos, deixando a partida em um estado "zumbi" (ex: round preso no fim sem começar o próximo). O correto seria uma máquina de estados idempotente baseada em timestamps no loop de `tick`.

### 3. Lógica de Combate Corpo-a-Corpo (Melee) Hardcoded
- **Localização:** `ShootingSystem.ts` e `GameRoom.ts`.
- **Inconsistência:** O combate com faca (`knife`) é tratado como um caso especial com lógica manual de detecção de proximidade, em vez de ser integrado ao sistema geral de armas e atributos.
- **Impacto:** Dificulta o balanceamento e a adição de novas armas brancas, além de gerar eventos "fake" (ex: mortes por explosão da bomba são registradas como `weaponId: 'knife'`).

### 4. Sistema de Inventário Incompleto
- **Localização:** `GameRoom.ts` (`dropWeapon`).
- **Inconsistência:** A função `dropWeapon` apenas deleta a arma do inventário do jogador, sem instanciar um objeto físico (pickup) no mapa.
- **Impacto:** Mecânica tática essencial de "dropar armas para aliados" ou "roubar armas de inimigos" está ausente.

### 5. Filtragem de Visibilidade (Fog of War) Ineficiente
- **Localização:** `GameRoom.ts` (`broadcastSnapshot`) e `VisibilitySystem.ts`.
- **Inconsistência:** O servidor mascara a posição de inimigos invisíveis enviando `-9999`, mas ainda envia o objeto `PlayerState` completo.
- **Impacto:** Desperdício de largura de banda e potencial exposição de metadados sensíveis (como HP ou economia) de inimigos que não deveriam estar no snapshot do cliente.

### 6. Timesteps de Reconciliação Inconsistentes
- **Localização:** `InputSystem.ts` (`applyCorrection`).
- **Inconsistência:** A reconciliação usa um passo de tempo fixo de `1/60` para re-aplicar inputs, enquanto o servidor simula a `1/128` (128-tick).
- **Impacto:** Drift acumulado na posição do jogador após múltiplas correções do servidor.

## 🤖 Guide for AI Assistants (Future Maintenance)
To maintain alignment with this project, follow these rules:

1.  **P0 - Performace First:** Never use heavy libraries (Three.js, PixiJS). Stick to the optimized Canvas2D renderer.
2.  **P0 - Shared Source of Truth:** Any constant, formula, or type MUST reside in `packages/shared`. Never duplicate constants between client and server.
3.  **Debugging Routine:**
    - If the server crashes on start: Check `MAPS` keys in `shared/maps.ts` vs the `mapId` in `LobbyManager`.
    - If inputs feel laggy: Check `InputSystem.ts` for `movementX/Y` vs `clientX/Y` handling.
4.  **Sensitive Files:**
    - `GameRoom.ts`: The central nervous system. Very sensitive to changes in the tick loop.
    - `PhysicsSystem.ts`: Handles all collisions. Small changes here can cause players to clip through walls.
    - `gameStore.ts`: Browser-side state. Be careful with imports (use `import type` where possible to avoid bundling server-side logic).

## 🚀 Future Roadmap & Ideas
- **Abilities:** Flashbangs (frustum-based blindness), Smoke (circular vision blockers), and Molly (area damage).
- **Matchmaking:** Ranked ladders and Elo-based queuing.
- **Spectator Mode:** Real-time delay for competitive integrity.

---

## 🛠️ Implementation Plan: Economy & Buy Phase Polish

### 1. Buy Menu Auto-Close
The `BuyMenu` must listen to the `round.phase` state. If the phase transitions from `buy` to `combat`, the menu must immediately close to prevent players from buying mid-round.

### 2. Refund System (Sell Back)
- **Logic:** In the Buy Phase, if a player clicks an item they already own, the server should remove the item and return 100% of the credits.
- **Visuals:** 
    - **Affordable:** White vibrante text/border.
    - **Locked/Owned:** Green/White (Owned) or Grey (Not affordable).
    - **Interactive:** Hover effects should be distinct.

### 3. Visual FX: Bullets & Impact
- **Tracers:** Neon yellow lines drawn in the foreground.
- **Impacts:** Spawning "impact" particles (6-8 per hit) that fly outwards from the collision point.

---

## 📁 Critical File Reference
| File | Sensitivity | Common Issues |
| :--- | :--- | :--- |
| `packages/server/src/game/GameRoom.ts` | **EXTREME** | Tick loop timing, map data crashes. |
| `packages/client/src/stores/gameStore.ts` | **HIGH** | Bundle errors (`require` vs `import`). |
| `packages/shared/src/index.ts` | **MEDIUM** | Constant mismatches between client/server. |
| `packages/client/src/game/GameRenderer.ts` | **MEDIUM** | Performance drops if too many effects are added. Scalability with map size. |

## ⚠️ Pontos de Atenção & Bugs Recentes (Registro Arquitetural)

Esta seção documenta os problemas críticos enfrentados durante o desenvolvimento, com o mapeamento técnico entre o problema e a solução adotada, servindo como base de conhecimento para evitar regressões futuras.

### 1. Bug do Tiro "Congelado" (Freeze no 1º Disparo)
- **Problema (O que ocorria):** O jogador atirava com uma arma semi-automática (ex: Classic, Operator) uma única vez e o jogo parecia travar/parar de funcionar, ignorando os próximos tiros.
- **Causa Raiz (Técnica):** O sistema `InputSystem` do cliente enviava o estado `shooting: true` de forma contínua enquanto o botão estivesse pressionado. No `ShootingSystem` (Servidor), armas `automatic: false` retornavam silenciosamente quando disparadas sem "soltar" o gatilho, mas como o `input.shooting` continuava `true`, a função `resetCharge` nunca era chamada. O estado do tiro travava eternamente no frame subsequente.
- **Solução Implementada:** 
  - Criação do mapa `wasShootingMap` no `ShootingSystem`.
  - Agora, se a arma não for automática, o servidor trava a capacidade de atirar até que ele receba explicitamente um pacote com `input.shooting: false` (o que aciona a função `stopShooting` em `GameRoom.ts`), restaurando o comportamento semi-automático perfeitamente e esvaziando o buffer corretamente.

### 2. Rendering Fatal Crash (NaN no Canvas)
- **Problema (O que ocorria):** Ocasionalmente o tiro (mesmo se consertado o bug acima) travava a tela toda do cliente, necessitando dar "F5".
- **Causa Raiz (Técnica):** Ao atirar muito próximo de cantos ou colidindo em bordas de paredes zero-distance, a função `lagCompensatedRaycast` devolvia `hitPos` como `NaN` (Not a Number) devido a divisão por distâncias extremamente baixas. Quando o `GameRenderer` tentava rodar `ctx.arc(NaN, NaN)`, o loop `requestAnimationFrame` quebrava silenciosamente, parando o visual do jogo.
- **Solução Implementada:** 
  - Adição de `Safeguards` (`isNaN`) críticos na função `GameRenderer.addEffect`. O cliente ignora nativamente qualquer tentativa de desenhar posições matemáticas corrompidas.

### 3. Bug da Câmera Travada e Movimentação ("O player atira e para")
- **Problema:** O usuário relatou que, após disparar o primeiro tiro com a arma padrão (Classic), o personagem parava de se mover na tela, e a câmera não retornava ao jogador no início da rodada seguinte (ficando presa no local da morte/disparo).
- **Causa:** Na classe `GameRenderer.ts`, a função `addEffect` tentava aplicar `screenShake` baseado nos status da arma (`weapon.screenShake`). Porém, armas básicas (como a Classic) não possuíam o atributo `screenShake` definido em `WEAPON_STATS`, resultando em `undefined`. Multiplicar `undefined` gerava `NaN` para `this.shake.x` e `this.shake.y`. Com `this.camX` e a translação do Canvas infectadas por `NaN`, a câmera congelava visualmente de forma irreversível. A falsa percepção era de que "a bala bateu no player e travou ele".
- **Solução:** Adicionado *fallback* seguro `(weapon.screenShake || 0)` e verificações estritas de NaN na lógica de trepidação de tela, garantindo que armas sem shake não quebrem a matriz do Canvas. Adicionada também uma verificação extra no loop de hits no servidor por garantia.

### 4. Confusão Visual do Mapa & Colisões Falhas
- **Problema (O que ocorria):** O mapa antigo usava Arrays de coordenadas avulsas para definir as paredes (`x1, y1, x2, y2`). Isso gerava cantos mal-fechados, colisões esquisitas, buracos onde a bala varava e um *level design* caótico que confundia o jogador taticamente.
- **Causa Raiz (Técnica):** Falta de uma estrutura ortogonal rigorosa (Snap-to-Grid).
- **Solução Implementada:** 
  - **Tile-based Map Parser (`mapParser.ts`):** O `MAP_OMEGA` foi refatorado para uma visualização em ASCII-Grid pura.
  - `#` define paredes lógicas. O parser lê esse texto e gera os vértices retangulares perfeitos, mesclando paredes adjacentes para melhoria de *Raycasting* (essencial para não pesar o processamento em mapas gigantes).
  - Isso resolve simultaneamente a geração de luz (Fog of War) do "Among Us" style, já que blocos retos projetam sombras sem vazamentos.

### Outros Detalhes Menores e Refinamentos:
- **Lobby Chat Sync:** O `useLobbyStore` precisa ouvir eventos de `lobby_chat`.
- **Bullet Tracers:** Se dependerem dos eventos `bullet_hit`, caso a bala se perca (por ex, varando o mundo), o evento pode não ser disparado, não mostrando traços.
- **Dynamic Barriers (Barreiras B):** Adicionado suporte no `mapParser.ts` para tiles `B`. Elas representam Barreiras que têm colisão ativa e são renderizadas em ciano brilhante (`#00FFFF`) durante a Buy Phase (`round.barriersUp`), mas ignoram as restrições de `Fog of War` (não geram sombra), garantindo visão além delas. Quando o round começa, elas perdem a colisão e tornam-se invisíveis.
- **Global Buy Zone:** Durante a Fase de Compra, a restrição de distância de compra foi completamente removida. O jogador agora pode abrir a loja e comprar de **qualquer lugar** do mapa, desde que a fase seja válida.

---

## 📝 Diário de Bordo & Auditoria de Progresso (Refatoração de Economy & Combate)

Durante a última fase de implementação, diversos ajustes críticos foram aplicados, mas alguns débitos arquiteturais e bugs foram identificados e necessitam de documentação para não serem perdidos nas próximas fases de desenvolvimento.

### Implementações Concluídas (✅)
- **Host Team-Switch (`LobbyManager`):** Implementado botão "⇄" na `LobbyPage` permitindo que apenas o host consiga mover jogadores entre times livremente. 
- **Inventário de 4 Slots (`InputSystem`, `HUD.tsx`):** UI centralizada e suporte à tecla `4` para Nuke.
- **Interações Mutuamente Exclusivas (`HUD.tsx`):** Melhoria no HUD de Desarmar/Plantar baseando-se em proximidade e prioridade (cooldown de 2s para manuseio da spike usando `E`, e `Q` para plantar/desarmar).
- **Mecânicas de Faca (`PhysicsSystem`):** Implementada inércia de *ice-skating* via `applyKnifeFriction` e bônus de velocidade de 1.6x.
- **Armas Automáticas (`ShootingSystem`):** Corrigido disparo contínuo de armas como Ares/Odin.
- **Round Reset Focado:** Munição e armadura agora persistem entre rounds; somente HP e posição são resetados (`GameRoom.beginBuyPhase`).
- **Economy & Auto-Restore:** Vender a arma sem ter outra restaura a `classic` automaticamente.

### Bugs Identificados e Corrigidos (🩹)
- **Tipagem de Evento (`shared/index.ts`):** O evento `bullet_hit` estava sendo emitido pelo servidor como `any` e não estava catalogado na interface `ServerToClientEvents`. Corrigido com a introdução da interface `BulletHitEvent`.
- **Código Morto (`GameRoom.ts`):** Removida a função `movePlayer` do `GameRoom.ts` que era inutilizada, visto que as trocas de time feitas pelo Host só têm efeito na `LobbyPage` via `LobbyManager` antes da partida começar.

### Pontos de Atenção & Lógicas Incompletas (⚠️ EXIGEM ESFORÇO FUTURO)
- **Armas Dropadas (Drop Físico Ausente):** O plano de implementação exigia que a função `dropWeapon` criasse um *pickup* no mapa. Contudo, devido à complexidade arquitetural (exigiria injetar arrays de `droppedWeapons` no `GameSnapshot`, sincronizar, renderizar sprites e adicionar colisões de *pickup* no cliente), a ação de *drop* (tecla `G`) atualmente apenas deleta a arma do inventário do jogador, substituindo pela próxima melhor. Isso quebra a economia tática (dropar para aliados).
- **Ícone de Arma no Renderizador (`GameRenderer.ts`):** O passo 11 do plano de implementação previa a renderização de uma miniatura do slot de arma abaixo do jogador, mas isso foi ignorado pelo agente anterior. Atualmente, os inimigos e aliados são apenas formas geométricas genéricas e não é possível identificar visualmente a arma que empunham.

---

## 💾 Logs Anteriores: Implementation Plan

<details>
<summary>Clique para expandir o plano executado anteriormente</summary>

# Tactical FPS — Implementation Plan

## Escopo das Mudanças
Correção sistêmica de bugs e implementação das features solicitadas.

### Proposed Changes
1. `packages/shared/src/index.ts`: Rebalanceamento Ares/Spectre, evento `move_player`.
2. `packages/server/src/lobby/LobbyManager.ts`: `movePlayer(hostId, targetId, team)`.
3. `packages/server/src/network/lobbyHandlers.ts`: handler `move_player`.
4. `packages/server/src/game/GameRoom.ts`: Round reset fix, Classic restore, Nuke cooldown, Drop logic.
5. `packages/server/src/game/systems/PhysicsSystem.ts`: Knife friction.
6. `packages/server/src/game/systems/ShootingSystem.ts`: Knife speed buff, Machine gun.
7. `packages/server/src/game/systems/EconomySystem.ts`: Classic auto-restore.
8. `packages/client/src/game/InputSystem.ts`: Digit4, Q para drop.
9. `packages/client/src/components/HUD.tsx`: Desarmar Nuke proximity, 4 slots.
10. `packages/client/src/pages/LobbyPage.tsx`: Move player UI host.
11. `packages/client/src/game/GameRenderer.ts`: Weapon miniatura.

</details>

---

## 🔮 Plano de Refatoração e Otimização Profunda (v2.0)

Este plano foi concebido após uma bateria rigorosa de testes teóricos e práticos na estrutura do projeto. O objetivo principal das próximas iterações deve focar em **performance bruta** e **arquitetura escalável**, removendo gargalos de repetição e melhorando o uso da rede.

### 1. Refatoração do Motor Gráfico (Renderer)
- **Problema Atual:** O `GameRenderer` usa puramente a API do `CanvasRenderingContext2D`. Funções de preenchimento complexas (como o algoritmo raycasting de visibilidade `evenodd`) e efeitos dinâmicos (gradientes, arcos) com manipulação pesada de `alpha` são EXTREMAMENTE custosas para o processador (CPU) em cada frame.
- **Solução Futura:** Migrar o core visual para **WebGL** (através de uma biblioteca minimalista ou shaders customizados em PixiJS restrito). Shaders fariam o *Fog of War* e as emissões de neon via GPU com custo quase nulo, liberando a CPU para a interpolação fluida de 144Hz+.

### 2. Otimização de Colisões (PhysicsSystem)
- **Problema Atual:** No servidor, a verificação de física percorre um loop `O(n*m)` linear, testando todos os jogadores contra todas as paredes em cada um dos 128 ticks. Mapas complexos vão matar a performance do host.
- **Solução Futura:** Implementar uma árvore de partição espacial **QuadTree** ou **Spatial Hash Grid** no servidor e no parser do mapa. Jogadores só testariam colisões com a "célula" em que estão no momento, tornando a lógica `O(1)` e extremamente barata.

### 3. Melhoria na Estrutura de Rede (Delta Compression)
- **Problema Atual:** A cada 1/128 avos de segundo, o servidor envia o objeto `GameSnapshot` completo, contendo *todos* os dados de *todos* os jogadores visíveis (HP, coordenadas, ângulos, munição). Isso é um desperdício enorme de largura de banda.
- **Solução Futura:** Implementar **Delta Compression**. O servidor envia o snapshot "cheio" apenas uma vez (ou ao reconectar). Depois, envia apenas os dados que *mudaram* (ex: "ID x moveu para Y"). Além disso, os dados devem ser empacotados em buffers binários (MessagePack ou Float32Array) ao invés de JSON legível via WebSockets brutos.

### 4. Extração Completa das Máquinas de Estado
- **Problema Atual:** A lógica do que um player pode ou não fazer, os timers do round (`MatchSystem`) e as regras da Nuke estão soltas em `GameRoom.ts`. O código está virando uma classe "Deus" (God Class) gigantesca.
- **Solução Futura:** Introduzir o padrão **Entity-Component-System (ECS)** de forma modular no Node. Separar lógicas como `NukeSystem`, `BuyPhaseSystem`, `VisibilitySystem` de forma estrita onde eles se comunicam através de um Event Bus local (e não via instâncias diretas do `socket.io` vazando pelos módulos).

### 5. Spectator Mode & Replay Buffer
- **Problema Atual:** Câmera de jogadores mortos fica cega e não pode circular pelas vistas dos aliados.
- **Solução Futura:** Enviar o snapshot integral para o cliente no modo espectador, mas gerenciar a propriedade de câmera (target id) localmente. Isso também abre margem para guardar esses snapshots em memória no servidor e gravar um arquivo binário da partida (Demofile) para replays estilo CS:GO.

### 6. Sistema Completo de Drop de Armas & Inventário Dinâmico (Requisitado)
- **Problema Atual:** A função atual de *drop* (tecla G) apenas apaga a arma da memória. O usuário exige que a arma permaneça fisicamente no chão do mapa, que seja visível através de uma miniatura sprite, e que possa ser pega novamente. Ele também quer que a pistola padrão (Classic) possa ser "dropada" e que não volte magicamente (a menos que outra arma secundária seja vendida na fase de compras).
- **Solução Futura:**
  - **Modelagem de Dados:** Criar a interface `DroppedWeapon { id: string, weaponId: WeaponId, position: Vec2 }` no `shared/index.ts`.
  - **State do Servidor:** Adicionar `droppedWeapons: Map<string, DroppedWeapon>` no `GameRoom.ts`.
  - **Sincronização:** Enviar a lista de `droppedWeapons` no `GameSnapshot`.
  - **Interação:** Modificar a verificação de interação (`E` key) no servidor para checar colisões não apenas com a Nuke, mas iterar pela lista de armas no chão.
  - **Classic Drop:** Remover a linha `this.economy.ensureClassic(player)` da função `dropWeapon` e delegar a restauração da Classic EXCLUSIVAMENTE para a ação de vender armas (na `EconomySystem`).
  - **Renderização Visual:** No `GameRenderer.ts`, adicionar um loop para desenhar os *sprites* icônicos/distintos (ex: silhuetas vetorizadas em Canvas) de cada arma caída no chão, de forma semelhante a como a Nuke já é renderizada brilhando no chão.
