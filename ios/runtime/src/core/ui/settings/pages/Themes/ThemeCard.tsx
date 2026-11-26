import AddonCard, { CardWrapper } from "@core/ui/components/AddonCard";
import { VdThemeInfo, themes, selectTheme } from "@lib/addons/themes";
import { findAssetId } from "@lib/api/assets";
import { settings } from "@lib/api/settings";
import { showToast } from "@lib/ui/toasts";
import { showSheet } from "@lib/ui/sheets";
import { NavigationNative, React } from "@metro/common";
import { View } from "react-native";

export default function ThemeCard({ item: theme, overridden, beforeSelect }: CardWrapper<VdThemeInfo> & {
  overridden?: boolean;
  beforeSelect?(): void;
}) {
  const navigation = NavigationNative.useNavigation();
  const [removed, setRemoved] = React.useState(false);

  // This is needed because of React™
  if (removed) return null;

  const { authors } = theme.data;
  const colors = theme.data.rawColors;
  const semantic = theme.data.semanticColors;
  const swatches = [semantic?.BACKGROUND_PRIMARY?.[0], semantic?.BACKGROUND_SECONDARY?.[0], semantic?.TEXT_NORMAL?.[0], colors?.BRAND_500]
    .filter((color): color is string => typeof color === "string" && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(color));

  return (
    <AddonCard
      headerLabel={theme.data.name}
      headerSublabel={
        authors ? `by ${authors.map((i) => i.name).join(", ")}` : ""
      }
      descriptionLabel={theme.data.description ?? "No description."}
      preview={swatches.length ? <View accessibilityLabel="Theme palette" style={{ flexDirection: "row", gap: 4 }}>
        {swatches.map((color, index) => <View key={index} style={{ flex: 1, height: 20, borderRadius: 6, backgroundColor: color }} />)}
      </View> : undefined}
      toggleType={!settings.safeMode?.enabled ? "radio" : undefined}
      toggleValue={() => !overridden && themes[theme.id].selected}
      onToggleChange={async (v: boolean) => {
        try {
          if (v) beforeSelect?.();
          await selectTheme(v ? theme : null);
          showToast(v ? `Applied ${theme.data.name}` : "Theme disabled", findAssetId("Check"));
        } catch (e: any) {
          console.error("Error while selecting theme:", e);
          showToast(e?.message ?? "Could not apply theme", findAssetId("CircleXIcon-primary"));
        }
      }}
      overflowTitle={theme.data.name}
      actions={[
        {
          icon: "CircleInformationIcon-primary",
          onPress: () => {
            const importPromise = import("./sheets/ThemeInfoActionSheet");
            showSheet("ThemeInfoActionSheet", importPromise, {
              theme,
              navigation,
            });
          },
        },
      ]}
    />
  );
}
