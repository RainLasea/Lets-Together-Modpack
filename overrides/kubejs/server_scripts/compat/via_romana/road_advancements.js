// Via Romana uses hardcoded advancement IDs; retain invisible signals only.
const LT_ADVANCEMENT_LOCATION = Java.loadClass('net.minecraft.resources.ResourceLocation')
const LT_ROAD_ADVANCEMENTS = {
  "via_romana:story/a_strand_type_game": "letstogether:travel/road",
  "via_romana:story/i_just_felt_like_running": "letstogether:travel/long_road",
  "via_romana:story/straight_up_pathing_it": "letstogether:travel/straight_road"
}

function grantRoadAdvancement(player, target) {
  if (!player.isAdvancementDone(LT_ADVANCEMENT_LOCATION.parse(target))) {
    player.runCommandSilent('advancement grant @s only ' + target)
  }
}

PlayerEvents.advancement(event => {
  const target = LT_ROAD_ADVANCEMENTS[event.advancement.getId().toString()]
  if (target) grantRoadAdvancement(event.player, target)
})

// Existing saves can already contain completed road signals.
PlayerEvents.loggedIn(event => {
  Object.keys(LT_ROAD_ADVANCEMENTS).forEach(source => {
    if (event.player.isAdvancementDone(LT_ADVANCEMENT_LOCATION.parse(source))) {
      grantRoadAdvancement(event.player, LT_ROAD_ADVANCEMENTS[source])
    }
  })
})
