const MANA_HUD_CHANNEL = 'letstogether:mana_hud'
const MANA_HUD_RESOURCE_LOCATION = Java.loadClass('net.minecraft.resources.ResourceLocation')
const REQUIRED_ADVANCEMENT = 'letstogether:magic/inscription_table'
const LEGACY_MANA_ADVANCEMENT = 'irons_spellbooks:irons_spellbooks/root'

function pushManaHudState(player) {
  const done = player.isAdvancementDone(MANA_HUD_RESOURCE_LOCATION.parse(REQUIRED_ADVANCEMENT))
  const legacyDone = player.isAdvancementDone(MANA_HUD_RESOURCE_LOCATION.parse(LEGACY_MANA_ADVANCEMENT))
  if (done || legacyDone) player.persistentData.letstogetherManaHudUnlocked = true
  player.sendData(MANA_HUD_CHANNEL, { unlocked: !!player.persistentData.letstogetherManaHudUnlocked })
}

PlayerEvents.advancement(event => {
  const id = event.advancement.getId().toString()
  if (id !== REQUIRED_ADVANCEMENT && id !== LEGACY_MANA_ADVANCEMENT) return
  pushManaHudState(event.player)
})

PlayerEvents.loggedIn(event => {
  pushManaHudState(event.player)
})
