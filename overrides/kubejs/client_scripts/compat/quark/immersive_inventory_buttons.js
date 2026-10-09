const $IIQuarkContainerScreen = Java.loadClass('net.minecraft.client.gui.screens.inventory.AbstractContainerScreen')
const $IIQuarkMiniButton = Java.loadClass('org.violetmoon.quark.content.management.client.screen.widgets.MiniInventoryButton')
const $IIQuarkMinecraft = Java.loadClass('net.minecraft.client.Minecraft')
const $IIQuarkResourceLocation = Java.loadClass('net.minecraft.resources.ResourceLocation')
const $IIQuarkPriority = Java.loadClass('net.neoforged.bus.api.EventPriority')
const II_QUARK_SENTINEL = $IIQuarkResourceLocation.parse('minecraft:textures/gui/interfaces/chests/chest.png')
let iiQuarkRenderFailed = false

NativeEvents.onEvent(
  $IIQuarkPriority.LOWEST,
  Java.loadClass('net.neoforged.neoforge.client.event.ScreenEvent$Render$Post'),
  event => {
    if (iiQuarkRenderFailed) return
    try {
      let screen = event.getScreen()
      if (!(screen instanceof $IIQuarkContainerScreen)) return
      if (!$IIQuarkMinecraft.getInstance().getResourceManager().getResource(II_QUARK_SENTINEL).isPresent()) return

      let children = screen.children()
      let graphics = null
      let pose = null
      try {
        for (let i = 0; i < children.size(); i++) {
          let child = children.get(i)
          if (!(child instanceof $IIQuarkMiniButton) || !child.visible) continue

          if (graphics === null) {
            graphics = event.getGuiGraphics()
            graphics.flush()
            pose = graphics.pose()
            pose.pushPose()
            pose.translate(0, 0, 200)
          }
          child.render(graphics, event.getMouseX(), event.getMouseY(), event.getPartialTick())
        }
        if (graphics !== null) graphics.flush()
      } finally {
        if (pose !== null) pose.popPose()
      }
    } catch (err) {
      iiQuarkRenderFailed = true
    }
  }
)
