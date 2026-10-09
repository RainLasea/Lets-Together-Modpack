// Keep interface overrides and the Ribbits translation above installed packs and filters.
ClientEvents.generateAssets('last', function (event) {
    var location = Java.loadClass('net.minecraft.resources.ResourceLocation')
    // KubeJS blocks java.nio.file.Files; Commons IO reads raw GLSL and JSON as UTF-8.
    var files = Java.loadClass('org.apache.commons.io.FileUtils')
    var resources = [
        'minecraft:shaders/core/position_tex.json',
        'minecraft:shaders/core/position_tex_old.fsh',
        'minecraft:shaders/core/position_tex_old.vsh',
        'minecraft:shaders/include/interfaces.glsl',
        'farmersdelight:lang/zh_cn.json',
        'ribbits:lang/zh_cn.json'
    ]
    resources.forEach(function (id) {
        // KubeJS converts File arguments relative to the game directory.
        // Path.resolve(String) can select its Path overload and discard the assets root.
        var file = 'kubejs/assets/' + id.replace(':', '/')
        event.text(location.parse(id), files.readFileToString(file, 'UTF-8'))
    })
})
