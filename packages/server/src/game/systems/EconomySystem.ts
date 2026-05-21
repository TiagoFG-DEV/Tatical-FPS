import type { PlayerState, WeaponId, ArmorType, BuyResult } from '@tactical-fps/shared';
import { WEAPON_STATS, ARMOR_STATS, GAME_CONSTANTS } from '@tactical-fps/shared';

export class EconomySystem {
  buy(player: PlayerState, item: WeaponId | ArmorType): BuyResult {
    // Armor purchase
    if (item === 'light' || item === 'heavy' || item === 'none') {
      const armor = ARMOR_STATS[item as ArmorType];

      // If player already has this armor type → sell it back (toggle)
      if (player.armorType === item && item !== 'none') {
        player.credits = Math.min(9000, player.credits + armor.cost);
        player.armorType = 'none';
        player.armor = 0;
        player.hasHelmet = false;
        return { success: true, newCredits: player.credits, item };
      }

      if (player.credits < armor.cost) {
        return { success: false, error: 'Not enough credits', newCredits: player.credits, item };
      }

      // If upgrading armor, refund the old one
      if (player.armorType !== 'none') {
        const oldArmor = ARMOR_STATS[player.armorType];
        player.credits += oldArmor.cost;
      }

      player.credits -= armor.cost;
      player.armorType = item as ArmorType;
      player.armor = 100;
      player.hasHelmet = armor.hasHelmet;
      return { success: true, newCredits: player.credits, item };
    }

    // Weapon purchase
    const weapon = WEAPON_STATS[item as WeaponId];
    if (!weapon || weapon.cost === 0) {
      return { success: false, error: 'Cannot buy that weapon', newCredits: player.credits, item };
    }
    if (player.credits < weapon.cost) {
      return { success: false, error: 'Not enough credits', newCredits: player.credits, item };
    }

    // Already owned → sell back (toggle/refund behavior)
    if (player.weapons.includes(item as WeaponId)) {
      return this.sellItem(player, item as WeaponId);
    }

    // Slot conflict: remove existing weapon in same slot
    const existingSlot = player.weapons.find(w => w !== 'knife' && WEAPON_STATS[w].slot === weapon.slot);
    if (existingSlot) {
      // Refund existing weapon before buying new one
      const oldWeapon = WEAPON_STATS[existingSlot];
      player.credits += oldWeapon.cost;
      player.weapons = player.weapons.filter(w => w !== existingSlot);
    }

    player.credits -= weapon.cost;
    player.weapons.push(item as WeaponId);
    player.activeWeapon = item as WeaponId;
    player.ammo[item as WeaponId] = weapon.magSize;
    player.reserveAmmo[item as WeaponId] = weapon.reserveAmmo;

    return { success: true, newCredits: player.credits, item };
  }

  sellItem(player: PlayerState, item: WeaponId | ArmorType): BuyResult {
    // Cannot sell knife
    if (item === 'knife') {
      return { success: false, error: 'Cannot sell knife', newCredits: player.credits, item };
    }

    // Armor refund
    if (item === 'light' || item === 'heavy') {
      if (player.armorType !== item) {
        return { success: false, error: 'You do not own this armor', newCredits: player.credits, item };
      }
      const armor = ARMOR_STATS[item];
      player.credits = Math.min(9000, player.credits + armor.cost);
      player.armorType = 'none';
      player.armor = 0;
      player.hasHelmet = false;
      return { success: true, newCredits: player.credits, item };
    }

    // Weapon refund
    if (!player.weapons.includes(item as WeaponId)) {
      return { success: false, error: 'You do not own this weapon', newCredits: player.credits, item };
    }

    const weapon = WEAPON_STATS[item as WeaponId];
    player.credits = Math.min(9000, player.credits + weapon.cost);
    player.weapons = player.weapons.filter(w => w !== item);

    // If we sold active weapon, switch to next available
    if (player.activeWeapon === item) {
      // Prefer pistol → primary → knife
      const secondary = player.weapons.find(w => w !== 'knife' && WEAPON_STATS[w].slot === 'secondary');
      const primary = player.weapons.find(w => WEAPON_STATS[w].slot === 'primary');
      player.activeWeapon = secondary ?? primary ?? 'knife';
    }

    // Auto-restore Classic: if player has no pistol and no primary, give back classic free
    this.ensureClassic(player);

    return { success: true, newCredits: player.credits, item };
  }

  /**
   * Ensures the player always has a Classic if they have no other weapon (except knife).
   * Called after sells and at round start if needed.
   */
  ensureClassic(player: PlayerState): void {
    const hasAnyGun = player.weapons.some(w => w !== 'knife');
    if (!hasAnyGun) {
      if (!player.weapons.includes('classic')) {
        player.weapons.push('classic');
        // Reset ammo for classic
        player.ammo['classic'] = WEAPON_STATS['classic'].magSize;
        player.reserveAmmo['classic'] = WEAPON_STATS['classic'].reserveAmmo;
      }
      player.activeWeapon = 'classic';
    }
  }

  // Called at round end to award economy
  awardRoundEnd(
    players: Map<string, PlayerState>,
    winner: 'attackers' | 'defenders',
    lossStreak: Map<string, number>,
  ): { playerId: string; credits: number; delta: number; reason: string }[] {
    const updates: { playerId: string; credits: number; delta: number; reason: string }[] = [];

    for (const [, player] of players) {
      let delta = 0;
      const isWinner = player.team === winner;

      if (isWinner) {
        delta = GAME_CONSTANTS.WIN_BONUS;
        lossStreak.set(player.id, 0);
      } else {
        const streak = lossStreak.get(player.id) ?? 0;
        delta = Math.min(
          GAME_CONSTANTS.LOSS_BONUS_BASE + streak * GAME_CONSTANTS.LOSS_BONUS_INCREMENT,
          GAME_CONSTANTS.LOSS_BONUS_MAX,
        );
        lossStreak.set(player.id, streak + 1);
      }

      player.credits = Math.min(9000, player.credits + delta);
      updates.push({ playerId: player.id, credits: player.credits, delta, reason: isWinner ? 'Round win' : 'Loss bonus' });
    }

    return updates;
  }
}
