const RESPITE_TOTEM_ID = 'the_beyond:totem_of_respite'

const RespiteEventPriority = Java.loadClass('net.neoforged.bus.api.EventPriority')

const RespiteLivingDeathEvent =
  'net.neoforged.neoforge.event.entity.living.LivingDeathEvent'

const RespiteLivingDropsEvent =
  'net.neoforged.neoforge.event.entity.living.LivingDropsEvent'

const RespiteLivingExperienceDropEvent =
  'net.neoforged.neoforge.event.entity.living.LivingExperienceDropEvent'

const RESPITE_XP_MARKER = 'lets_together_respite_xp'
const RESPITE_DROP_MARKER = 'lets_together_respite_drops'

const respiteSavedDrops = new Map()

function respiteIsPlayer(entity) {
  return !!entity && entity.type === 'minecraft:player'
}

function respiteHasTotem(player) {
  return player.mainHandItem.id === RESPITE_TOTEM_ID ||
    player.offHandItem.id === RESPITE_TOTEM_ID
}

function respiteClearMarkers(player) {
  player.persistentData.remove(RESPITE_XP_MARKER)
  player.persistentData.remove(RESPITE_DROP_MARKER)
}

NativeEvents.onEvent(RespiteLivingDeathEvent, event => {
  const player = event.entity

  if (!respiteIsPlayer(player)) return

  respiteClearMarkers(player)
  respiteSavedDrops.delete(player.uuid.toString())

  if (!respiteHasTotem(player)) return

  player.persistentData.putBoolean(RESPITE_XP_MARKER, true)
  player.persistentData.putBoolean(RESPITE_DROP_MARKER, true)
})

NativeEvents.onEvent(
  RespiteEventPriority.HIGHEST,
  RespiteLivingExperienceDropEvent,
  event => {
    const player = event.entity

    if (!respiteIsPlayer(player)) return
    if (!player.persistentData.getBoolean(RESPITE_XP_MARKER)) return

    event.setDroppedExperience(0)
  }
)

NativeEvents.onEvent(
  RespiteEventPriority.HIGHEST,
  RespiteLivingDropsEvent,
  event => {
    const player = event.entity

    if (!respiteIsPlayer(player)) return
    if (!player.persistentData.getBoolean(RESPITE_DROP_MARKER)) return

    const drops = event.getDrops()
    const saved = []

    drops.forEach(drop => {
      saved.push(drop)
    })

    respiteSavedDrops.set(player.uuid.toString(), saved)
    drops.clear()
  }
)

NativeEvents.onEvent(
  RespiteEventPriority.LOWEST,
  RespiteLivingExperienceDropEvent,
  event => {
    const player = event.entity

    if (!respiteIsPlayer(player)) return
    if (!player.persistentData.getBoolean(RESPITE_XP_MARKER)) return

    event.setDroppedExperience(event.getOriginalExperience())
    player.persistentData.remove(RESPITE_XP_MARKER)
  }
)

NativeEvents.onEvent(
  RespiteEventPriority.LOWEST,
  RespiteLivingDropsEvent,
  event => {
    const player = event.entity

    if (!respiteIsPlayer(player)) return
    if (!player.persistentData.getBoolean(RESPITE_DROP_MARKER)) return

    const key = player.uuid.toString()
    const saved = respiteSavedDrops.get(key)

    if (saved) {
      saved.forEach(drop => {
        event.getDrops().add(drop)
      })

      respiteSavedDrops.delete(key)
    }

    player.persistentData.remove(RESPITE_DROP_MARKER)
  }
)