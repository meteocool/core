<script>
  import ScaleLine from '../ScaleLine.svelte';
  import legendClouds from '../../../public/assets/legend_clouds.svg';
  import legendRain from '../../../public/assets/legend_rain.svg';
  import legendHail from '../../../public/assets/legend_hail.svg';
  import legendThunderstorm from '../../../public/assets/legend_thunderstorm.svg';
  import { _ } from "svelte-i18n";

</script>

<style>
    .scale {
        width: 100%;
    }

</style>

<ScaleLine class="scale" valueFormat={ (fmt) => {
        switch (fmt) {
          case "64":
            return " ";
          case "74":
            return `<img src=${legendClouds} alt='${$_("drizzle")}' class="legend-icon" /> <span class='legendLabel'>${$_("drizzle")}</span>`;
          case "94":
            return `<img src=${legendRain} alt='${$_("rain")}' class="legend-icon"/> <span class='legendLabel'>${$_("rain")}</span>`;
          case "104":
            return `<img src=${legendThunderstorm} alt='${$_("heavy_rain")}' class="legend-icon"/> <span class='legendLabel'>${$_("heavy_rain")}</span>`;
          case "114":
            return `<img src=${legendHail} alt='${$_("hail")}' class="legend-icon"/> <span class='legendLabel'>${$_("hail")}</span>`;
          default:
            return "";
        }
      } } palette="58:a3a06728;59:a8a57032;60:acac7946;61:b1b18250;62:b6b88c64;63:bcbd936e;64:c1c39c82;65:c1c39c8c;66:cacdaaa0;67:cccfafaa;68:cccfb3be;69:c8ccb3c8;70:bfc3b3dc;71:bfc3b3e6;72:b8bdb3fa;73:b5bab3ff;74:acb3b3ff;75:aaafb3ff;76:a3aab3ff;77:a0a8b3ff;78:9aa1b3ff;79:97a0b3ff;80:909ab3ff;81:939ab5ff;82:8791b1ff;83:838eb1ff;84:7c89afff;85:7785aeff;86:7080aaff;87:6b7caaff;88:5e72a7ff;89:5e72a7ff;90:566da3ff;91:5269a3ff;92:4b64a1ff;93:4660a0ff;94:4260a1ff;95:4467a5ff;96:4975aeff;97:4d7cb1ff;98:508abaff;99:5491bfff;100:599ec6ff;101:5ba5caff;102:60b3d4ff;103:62bad8ff;104:67c8dfff;105:69cfe4ff;106:67d6d6ff;107:60d6c4ff;108:52d6a1ff;109:4bd690ff;110:3bd66dff;111:34d65bff;112:11d116ff;113:0fcd16ff;114:0fc316ff;115:0fbf15ff;116:0fb613ff;117:0eb313ff;118:0eaa13ff;119:0ca511ff;120:0c9e11ff;121:0c9911ff;122:0c900fff;123:0a8c0fff;124:0a830eff;125:0a800eff;126:0a770cff;127:08720cff;128:086b0aff;129:08660aff;130:085d08ff;131:1c6708ff;132:467c08ff;133:5b8707ff;134:839c05ff;135:97a805ff;136:c1bc05ff;137:d6c603ff;138:ffe200ff;139:ffd800ff;140:ffc800ff;141:ffc300ff;142:ffb500ff;143:ffb000ff;144:ffa700ff;145:ff9e00ff;146:ff9300ff;147:ff8900ff;148:ff7f00ff;149:ff0000ff;150:f00000ff;151:e90000ff;152:db0000ff;153:d40000ff;154:c60000ff;155:bf0000ff;156:b10000ff;157:aa0000ff;158:9a0000ff;159:930000ff;160:850000ff;161:7e0000ff;162:700000ff;163:ffffffff;164:ffe9ffff;165:ffdfffff;166:ffc8ffff;167:ffbdffff;168:ffa8ffff;169:ff9cffff;170:ff75ffff;171:fb6bfdff;172:f656f6ff;173:f24bf4ff;174:ed36efff;175:e92aebff;176:e416e6ff;177:e10ae2ff;178:ac00fbff;179:a300f6ff;180:9300efff;181:8700e9ff;182:7900e2ff;183:7200ddff;184:6200d6ff;185:6200d6ff" />
