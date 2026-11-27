"""
Generator proyek template QGIS (.qgz), simbologi, dan Print Layout PNG untuk modul hotspot-analyzer.

Catatan metodologis:
- Karena dataset titik kebakaran individual terverifikasi belum tersedia (individual_geocoded_count = 0),
  proyek ini disiapkan sebagai template jujur menggunakan layer nyata yang memang tersedia:
  1. Batas 21 Kecamatan Kota Medan (fallback OpenStreetMap, ODbL).
  2. Data agregat kejadian kebakaran 2023 per kecamatan (219 kejadian, bukan titik KDE).
  3. Titik terverifikasi Mako 0.0 Dinas Damkarmat Kota Medan (Satu Data Medan).
- Tidak ada titik kebakaran karangan maupun raster KDE palsu yang dibuat.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys
import zipfile

from qgis.core import (
    Qgis,
    QgsApplication,
    QgsClassificationQuantile,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsFillSymbol,
    QgsGraduatedSymbolRenderer,
    QgsLayoutExporter,
    QgsLayoutItemLabel,
    QgsLayoutItemLegend,
    QgsLayoutItemMap,
    QgsLayoutItemMapGrid,
    QgsLayoutItemPolygon,
    QgsLayoutItemScaleBar,
    QgsLayoutItemShape,
    QgsLayoutPoint,
    QgsLayoutSize,
    QgsLegendStyle,
    QgsLineSymbol,
    QgsMarkerSymbol,
    QgsPalLayerSettings,
    QgsPrintLayout,
    QgsProject,
    QgsTextBufferSettings,
    QgsTextFormat,
    QgsUnitTypes,
    QgsVectorLayer,
    QgsVectorLayerSimpleLabeling,
)
from qgis.PyQt.QtCore import QPointF, Qt
from qgis.PyQt.QtGui import QColor, QFont, QPolygonF


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
BOUNDARY_PATH = SCRIPT_DIR / "layers" / "medan_districts_osm.geojson"
MAKO_PATH = SCRIPT_DIR / "layers" / "mako_damkarmat_verified.geojson"
KDE_QML_PATH = SCRIPT_DIR / "styles" / "hotspot_kde_4kelas.qml"
QGZ_PATH = SCRIPT_DIR / "medan_hotspot_template.qgz"
PNG_PATH = SCRIPT_DIR / "exports" / "peta_agregat_kebakaran_medan_2023_template_kde.png"


def _make_font(family: str, size_pt: float, bold: bool = False) -> QFont:
    font = QFont(family, int(round(size_pt)))
    font.setPointSizeF(size_pt)
    font.setBold(bold)
    return font


def _style_aggregate_layer(layer: QgsVectorLayer) -> None:
    palette = [
        ("Rendah", "#E9C46A", "#7A6222"),
        ("Sedang", "#E79E4F", "#875114"),
        ("Tinggi", "#C8523B", "#7A2616"),
        ("Sangat Tinggi", "#7F1D1D", "#450A0A"),
    ]
    renderer = QgsGraduatedSymbolRenderer("incidents_2023")
    method = QgsClassificationQuantile()
    method.setLabelFormat("%1 - %2 kejadian")
    method.setLabelPrecision(0)
    method.setLabelTrimTrailingZeroes(True)
    renderer.setClassificationMethod(method)
    renderer.updateClasses(layer, 4)

    for idx, (label_name, fill_hex, stroke_hex) in enumerate(palette):
        if idx >= len(renderer.ranges()):
            break
        rng = renderer.ranges()[idx]
        sym = QgsFillSymbol.createSimple(
            {
                "color": fill_hex,
                "outline_color": stroke_hex,
                "outline_width": "0.35",
                "outline_style": "solid",
            }
        )
        sym.setOpacity(0.76)
        renderer.updateRangeSymbol(idx, sym)
        renderer.updateRangeLabel(
            idx, f"{label_name} ({int(rng.lowerValue())}-{int(rng.upperValue())} kejadian)"
        )

    layer.setRenderer(renderer)

    label_settings = QgsPalLayerSettings()
    label_settings.fieldName = "replace(\"district_name\", 'Medan ', 'M. ')"
    label_settings.isExpression = True
    text_format = QgsTextFormat()
    text_format.setFont(_make_font("Sans Serif", 7.0, bold=False))
    text_format.setSize(7.0)
    text_format.setColor(QColor("#202A2D"))
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(0.8)
    buf.setColor(QColor("#FFFFFF"))
    text_format.setBuffer(buf)
    label_settings.setFormat(text_format)
    layer.setLabeling(QgsVectorLayerSimpleLabeling(label_settings))
    layer.setLabelsEnabled(True)


def _style_boundary_layer(layer: QgsVectorLayer) -> None:
    sym = QgsFillSymbol.createSimple(
        {
            "color": "0,0,0,0",
            "outline_color": "#202A2D",
            "outline_width": "0.45",
            "outline_style": "solid",
        }
    )
    layer.renderer().setSymbol(sym)


def _style_mako_layer(layer: QgsVectorLayer) -> None:
    sym = QgsMarkerSymbol.createSimple(
        {
            "name": "square",
            "color": "#356067",
            "outline_color": "#FFFFFF",
            "outline_width": "0.5",
            "size": "3.4",
        }
    )
    layer.renderer().setSymbol(sym)

    label_settings = QgsPalLayerSettings()
    label_settings.fieldName = "'Mako 0.0 Damkarmat'"
    label_settings.isExpression = True
    label_settings.dist = 2.0
    text_format = QgsTextFormat()
    text_format.setFont(_make_font("Sans Serif", 7.5, bold=True))
    text_format.setSize(7.5)
    text_format.setColor(QColor("#356067"))
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(0.9)
    buf.setColor(QColor("#FFFFFF"))
    text_format.setBuffer(buf)
    label_settings.setFormat(text_format)
    layer.setLabeling(QgsVectorLayerSimpleLabeling(label_settings))
    layer.setLabelsEnabled(True)


def _add_rect(
    layout: QgsPrintLayout,
    x: float,
    y: float,
    w: float,
    h: float,
    fill_hex: str,
    stroke_hex: str | None = None,
    stroke_width_mm: float = 0.3,
) -> QgsLayoutItemShape:
    shape = QgsLayoutItemShape(layout)
    shape.setShapeType(QgsLayoutItemShape.Rectangle)
    shape.attemptMove(QgsLayoutPoint(x, y, QgsUnitTypes.LayoutMillimeters))
    shape.attemptResize(QgsLayoutSize(w, h, QgsUnitTypes.LayoutMillimeters))
    props = {"color": fill_hex}
    if stroke_hex:
        props["outline_color"] = stroke_hex
        props["outline_width"] = str(stroke_width_mm)
        props["outline_style"] = "solid"
    else:
        props["outline_style"] = "no"
    shape.setSymbol(QgsFillSymbol.createSimple(props))
    layout.addLayoutItem(shape)
    return shape


def _add_label(
    layout: QgsPrintLayout,
    text: str,
    x: float,
    y: float,
    w: float,
    h: float,
    font_size: float,
    color_hex: str = "#202A2D",
    bold: bool = False,
    mono: bool = False,
    halign: Qt.AlignmentFlag = Qt.AlignmentFlag.AlignLeft,
    valign: Qt.AlignmentFlag = Qt.AlignmentFlag.AlignTop,
) -> QgsLayoutItemLabel:
    lbl = QgsLayoutItemLabel(layout)
    lbl.setText(text)
    lbl.attemptMove(QgsLayoutPoint(x, y, QgsUnitTypes.LayoutMillimeters))
    lbl.attemptResize(QgsLayoutSize(w, h, QgsUnitTypes.LayoutMillimeters))
    fmt = QgsTextFormat()
    fmt.setFont(_make_font("IBM Plex Mono" if mono else "Sans Serif", font_size, bold=bold))
    fmt.setSize(font_size)
    fmt.setColor(QColor(color_hex))
    lbl.setTextFormat(fmt)
    lbl.setHAlign(halign)
    lbl.setVAlign(valign)
    lbl.setMarginX(1.0)
    lbl.setMarginY(0.5)
    layout.addLayoutItem(lbl)
    return lbl


def _add_north_arrow(layout: QgsPrintLayout, cx: float, cy: float) -> None:
    arrow_poly = QPolygonF(
        [
            QPointF(cx, cy - 5.5),
            QPointF(cx + 3.2, cy + 4.0),
            QPointF(cx, cy + 1.8),
            QPointF(cx - 3.2, cy + 4.0),
            QPointF(cx, cy - 5.5),
        ]
    )
    poly_item = QgsLayoutItemPolygon(arrow_poly, layout)
    poly_item.setSymbol(
        QgsFillSymbol.createSimple(
            {"color": "#202A2D", "outline_color": "#202A2D", "outline_width": "0.2"}
        )
    )
    layout.addLayoutItem(poly_item)
    _add_label(
        layout,
        "U",
        cx - 3.0,
        cy + 4.3,
        6.0,
        4.5,
        font_size=7.5,
        bold=True,
        halign=Qt.AlignmentFlag.AlignHCenter,
    )


def build_project() -> None:
    if not BOUNDARY_PATH.exists():
        raise RuntimeError(f"Berkas boundary tidak ditemukan: {BOUNDARY_PATH}")
    if not MAKO_PATH.exists():
        raise RuntimeError(f"Berkas Mako 0.0 tidak ditemukan: {MAKO_PATH}")

    qgs = QgsApplication([], False)
    qgs.initQgis()

    try:
        os.chdir(SCRIPT_DIR)
        project = QgsProject.instance()
        project.clear()
        project.setFileName(QGZ_PATH.name)
        project.setFilePathStorage(Qgis.FilePathType.Relative)

        utm_crs = QgsCoordinateReferenceSystem("EPSG:32647")
        wgs_crs = QgsCoordinateReferenceSystem("EPSG:4326")
        project.setCrs(utm_crs)
        project.setTitle("FireReach Medan - Template Proyek QGIS Hotspot Analyzer (EPSG:32647)")

        # Gunakan path relatif agar proyek dan Print Layout sepenuhnya portabel lintas komputer
        agg_layer = QgsVectorLayer(
            "./layers/medan_districts_osm.geojson",
            "Agregat Kebakaran 2023 per Kecamatan (Bukan KDE)",
            "ogr",
        )
        boundary_layer = QgsVectorLayer(
            "./layers/medan_districts_osm.geojson",
            "Batas 21 Kecamatan Medan (Fallback OSM)",
            "ogr",
        )
        mako_layer = QgsVectorLayer(
            "./layers/mako_damkarmat_verified.geojson",
            "Mako 0.0 Damkarmat Medan (Terverifikasi)",
            "ogr",
        )

        for lyr, name in (
            (agg_layer, "agregat 2023"),
            (boundary_layer, "batas kecamatan OSM"),
            (mako_layer, "Mako 0.0"),
        ):
            if not lyr.isValid():
                raise RuntimeError(f"Layer QGIS gagal dimuat: {name}")

        _style_aggregate_layer(agg_layer)
        _style_boundary_layer(boundary_layer)
        _style_mako_layer(mako_layer)

        project.addMapLayer(agg_layer, False)
        project.addMapLayer(boundary_layer, False)
        project.addMapLayer(mako_layer, False)

        root = project.layerTreeRoot()
        root.addLayer(mako_layer)
        root.addLayer(boundary_layer)
        root.addLayer(agg_layer)
        kde_group = root.addGroup("Output KDE Terverifikasi (Menunggu Titik Individual)")
        kde_group.setCustomProperty(
            "template_note",
            "Muat public/data/hotspot-analyzer.verified.geojson lalu terapkan styles/hotspot_kde_4kelas.qml",
        )

        # Print Layout A4 Landscape (297 x 210 mm)
        layout = QgsPrintLayout(project)
        layout.initializeDefaults()
        layout.setName("Layout Peta Agregat 2023 - Template KDE")
        page = layout.pageCollection().page(0)
        page.setPageSize("A4", page.Orientation.Landscape)

        # Latar archival paper
        _add_rect(layout, 0.0, 0.0, 297.0, 210.0, "#F4F2EC")
        # Header sheet
        _add_rect(layout, 10.0, 8.0, 277.0, 21.0, "#FFFFFF", "#D9DEDA", 0.3)
        _add_rect(layout, 10.0, 8.0, 2.0, 21.0, "#B84A35")
        _add_label(
            layout,
            "Peta Agregat Kejadian Kebakaran Kota Medan Tahun 2023 per Kecamatan",
            15.0,
            10.2,
            266.0,
            9.0,
            font_size=14.0,
            bold=True,
        )
        _add_label(
            layout,
            "Template Proyek QGIS Fire Hotspot Analyzer | Peta Agregat Kecamatan (219 Kejadian) - BUKAN Hasil KDE Titik Individual",
            15.0,
            19.0,
            266.0,
            7.0,
            font_size=9.0,
            color_hex="#556164",
        )

        # Hitung extent UTM 47N Kota Medan dengan padding merata
        wgs_extent = agg_layer.extent()
        ct = QgsCoordinateTransform(wgs_crs, utm_crs, project)
        utm_extent = ct.transformBoundingBox(wgs_extent)
        utm_extent.scale(1.12)

        map_item = QgsLayoutItemMap(layout)
        map_item.attemptMove(QgsLayoutPoint(10.0, 31.0, QgsUnitTypes.LayoutMillimeters))
        map_item.attemptResize(QgsLayoutSize(183.0, 160.0, QgsUnitTypes.LayoutMillimeters))
        map_item.setCrs(utm_crs)
        map_item.setLayers([mako_layer, boundary_layer, agg_layer])
        map_item.zoomToExtent(utm_extent)
        map_item.setBackgroundEnabled(True)
        map_item.setBackgroundColor(QColor("#FFFFFF"))
        map_item.setFrameEnabled(True)
        map_item.setFrameStrokeColor(QColor("#202A2D"))
        map_item.setFrameStrokeWidth(
            map_item.frameStrokeWidth()
        )

        grid = QgsLayoutItemMapGrid("UTM 47N Grid", map_item)
        grid.setEnabled(True)
        grid.setCrs(utm_crs)
        grid.setIntervalX(5000.0)
        grid.setIntervalY(5000.0)
        grid.setStyle(QgsLayoutItemMapGrid.Solid)
        grid.setFrameStyle(QgsLayoutItemMapGrid.InteriorTicks)
        grid.setAnnotationEnabled(True)
        grid.setAnnotationPrecision(0)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.ShowAll, QgsLayoutItemMapGrid.Left)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.ShowAll, QgsLayoutItemMapGrid.Bottom)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.HideAll, QgsLayoutItemMapGrid.Right)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.HideAll, QgsLayoutItemMapGrid.Top)
        grid.setAnnotationDirection(QgsLayoutItemMapGrid.Vertical, QgsLayoutItemMapGrid.Left)
        grid_fmt = QgsTextFormat()
        grid_fmt.setFont(_make_font("IBM Plex Mono", 6.5))
        grid_fmt.setSize(6.5)
        grid_fmt.setColor(QColor("#556164"))
        grid.setAnnotationTextFormat(grid_fmt)
        grid.setLineSymbol(
            QgsLineSymbol.createSimple(
                {"line_color": "217,222,218,175", "line_width": "0.18", "line_style": "solid"}
            )
        )
        map_item.grids().addGrid(grid)
        layout.addLayoutItem(map_item)

        # Panel samping kanan
        _add_rect(layout, 197.0, 31.0, 90.0, 160.0, "#FFFFFF", "#D9DEDA", 0.3)

        # Legenda
        legend = QgsLayoutItemLegend(layout)
        legend.setTitle("Legenda Peta")
        legend.setLinkedMap(map_item)
        legend.setAutoUpdateModel(False)
        legend_model = legend.model()
        legend_root = legend_model.rootGroup()
        # Hapus grup placeholder kosong dari legenda agar ringkas
        for child in list(legend_root.children()):
            if child.name().startswith("Output KDE"):
                legend_root.removeChildNode(child)
        legend.setStyleFont(QgsLegendStyle.Title, _make_font("Sans Serif", 9.5, bold=True))
        legend.setStyleFont(QgsLegendStyle.Subgroup, _make_font("Sans Serif", 8.0, bold=True))
        legend.setStyleFont(QgsLegendStyle.SymbolLabel, _make_font("Sans Serif", 7.3))
        legend.setSymbolWidth(5.5)
        legend.setSymbolHeight(3.5)
        legend.attemptMove(QgsLayoutPoint(200.0, 33.5, QgsUnitTypes.LayoutMillimeters))
        legend.attemptResize(QgsLayoutSize(84.0, 70.0, QgsUnitTypes.LayoutMillimeters))
        layout.addLayoutItem(legend)

        # Scale bar & North Arrow
        scale_bar = QgsLayoutItemScaleBar(layout)
        scale_bar.setLinkedMap(map_item)
        scale_bar.setStyle("Single Box")
        scale_bar.setUnits(QgsUnitTypes.DistanceKilometers)
        scale_bar.setUnitLabel("km")
        scale_bar.setNumberOfSegments(2)
        scale_bar.setNumberOfSegmentsLeft(0)
        scale_bar.setUnitsPerSegment(2.5)
        scale_bar.setHeight(2.5)
        scale_bar.setFont(_make_font("IBM Plex Mono", 7.0))
        scale_bar.attemptMove(QgsLayoutPoint(200.0, 108.0, QgsUnitTypes.LayoutMillimeters))
        scale_bar.attemptResize(QgsLayoutSize(64.0, 12.0, QgsUnitTypes.LayoutMillimeters))
        layout.addLayoutItem(scale_bar)
        _add_north_arrow(layout, 276.0, 114.0)

        # Kotak Kejujuran Data & Metodologi
        _add_rect(layout, 200.0, 124.0, 84.0, 64.0, "#FBF2E6", "#D58A43", 0.3)
        _add_rect(layout, 200.0, 124.0, 1.5, 64.0, "#8A5218")
        _add_label(
            layout,
            "CATATAN KEJUJURAN & METODOLOGI DATA\n"
            "1. Peta ini adalah peta agregat 2023 (219 kejadian, 21 kecamatan), BUKAN hasil KDE titik individual.\n"
            "2. Output KDE resmi belum tersedia karena titik kejadian kebakaran individual terverifikasi (exact_verified / address_geocoded_verified) belum dirilis; peta konsentrasi historis bukan prediksi kebakaran.\n"
            "3. Parameter Template KDE siap pakai:\n"
            "   CRS: EPSG:32647 -> EPSG:4326 | Kernel: Quartic\n"
            "   Bandwidth: 1.000 m | Piksel: 100 m | Quantile 4 kelas\n"
            "4. Sumber & Atribusi Batas:\n"
            "   Data kejadian 2023 & Mako 0.0: Damkarmat Kota Medan.\n"
            "   Batas kecamatan: OpenStreetMap Nominatim (ODbL,\n"
            "   © OpenStreetMap contributors), fallback non-resmi.",
            203.0,
            126.0,
            79.0,
            60.0,
            font_size=6.5,
            color_hex="#202A2D",
        )

        # Footer
        _add_label(
            layout,
            "FireReach Medan | Modul: hotspot-analyzer (Adeptri) | Style KDE siap pakai: styles/hotspot_kde_4kelas.qml | CRS Peta: EPSG:32647 (UTM Zone 47N)",
            10.0,
            200.5,
            277.0,
            6.5,
            font_size=7.5,
            color_hex="#556164",
            mono=True,
        )

        project.layoutManager().addLayout(layout)

        if not project.write(str(QGZ_PATH)):
            raise RuntimeError(f"Gagal menyimpan proyek QGIS ke {QGZ_PATH}")

        # Verifikasi bahwa .qgs di dalam .qgz tidak bergantung pada path absolut lokal
        with zipfile.ZipFile(QGZ_PATH, "r") as zf:
            qgs_names = [n for n in zf.namelist() if n.endswith(".qgs")]
            if not qgs_names:
                raise RuntimeError("Berkas .qgz tidak berisi file .qgs.")
            qgs_xml = zf.read(qgs_names[0]).decode("utf-8", errors="replace")
            if "C:\\" in qgs_xml or "C:/" in qgs_xml or "firereach-medan" in qgs_xml:
                raise RuntimeError(
                    "Proyek .qgz masih mengandung path absolut mesin lokal! Pastikan seluruh layer memakai path relatif."
                )

        PNG_PATH.parent.mkdir(parents=True, exist_ok=True)
        exporter = QgsLayoutExporter(layout)
        img_settings = QgsLayoutExporter.ImageExportSettings()
        img_settings.dpi = 150
        result = exporter.exportToImage(str(PNG_PATH), img_settings)
        if result != QgsLayoutExporter.Success:
            raise RuntimeError(f"Gagal mengekspor PNG layout (kode error {result}).")

        print(f"Berhasil membuat proyek QGIS relatif: {QGZ_PATH}")
        print(f"Berhasil mengekspor PNG layout jujur: {PNG_PATH}")
    finally:
        qgs.exitQgis()


if __name__ == "__main__":
    build_project()
