const MANA_HUD_CHANNEL = 'letstogether:mana_hud'
const MANA_LAYER = 'irons_spellbooks:mana_overlay'

let unlocked = false

NetworkEvents.dataReceived(MANA_HUD_CHANNEL, event => {
  try {
    unlocked = event.data.getBoolean('unlocked')
  } catch (err) {
    unlocked = false
  }
})

try {
  NativeEvents.onEvent(
    Java.loadClass('net.neoforged.neoforge.client.event.RenderGuiLayerEvent$Pre'),
    event => {
      if (unlocked) return

      let name = null
      try { name = event.name.toString() } catch (e) { return }

      if (name === MANA_LAYER) event.setCanceled(true)
    }
  )
} catch (err) {
}