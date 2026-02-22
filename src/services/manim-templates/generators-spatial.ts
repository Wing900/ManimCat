export function generate3DSurfaceCode(): string {
  return `from manim import *
import numpy as np

class MainScene(ThreeDScene):
    def construct(self):
        # 配置场景
        self.set_camera_orientation(phi=75 * DEGREES, theta=30 * DEGREES)

        # 创建坐标轴
        axes = ThreeDAxes()

        # 创建曲面
        def func(x, y):
            return np.sin(x) * np.cos(y)

        surface = Surface(
            lambda u, v: axes.c2p(u, v, func(u, v)),
            u_range=[-3, 3],
            v_range=[-3, 3],
            resolution=32,
            checkerboard_colors=[BLUE_D, BLUE_E]
        )

        # 添加自定义标签
        x_label = Text("x").next_to(axes.x_axis.get_end(), RIGHT)
        y_label = Text("y").next_to(axes.y_axis.get_end(), UP)
        z_label = Text("z").next_to(axes.z_axis.get_end(), OUT)

        # 创建动画
        self.begin_ambient_camera_rotation(rate=0.2)
        self.play(Create(axes), Write(x_label), Write(y_label), Write(z_label))
        self.play(Create(surface))
        self.wait(2)
        self.stop_ambient_camera_rotation()
        self.wait()
`;
}

export function generateSphereCode(): string {
  return `from manim import *
import numpy as np

class MainScene(ThreeDScene):
    def construct(self):
        # 配置场景
        self.set_camera_orientation(phi=75 * DEGREES, theta=30 * DEGREES)

        # 创建坐标轴
        axes = ThreeDAxes()

        # 创建球体
        sphere = Surface(
            lambda u, v: np.array([
                np.cos(u) * np.cos(v),
                np.cos(u) * np.sin(v),
                np.sin(u)
            ]),
            u_range=[-PI/2, PI/2],
            v_range=[0, TAU],
            checkerboard_colors=[BLUE_D, BLUE_E]
        )

        # 添加自定义标签
        x_label = Text("x").next_to(axes.x_axis.get_end(), RIGHT)
        y_label = Text("y").next_to(axes.y_axis.get_end(), UP)
        z_label = Text("z").next_to(axes.z_axis.get_end(), OUT)

        # 创建动画
        self.begin_ambient_camera_rotation(rate=0.2)
        self.play(Create(axes), Write(x_label), Write(y_label), Write(z_label))
        self.play(Create(sphere))
        self.wait(2)
        self.stop_ambient_camera_rotation()
        self.wait()
`;
}

export function generateCubeCode(): string {
  return `from manim import *

class MainScene(ThreeDScene):
    def construct(self):
        # 设置场景
        self.set_camera_orientation(phi=75 * DEGREES, theta=30 * DEGREES)
        axes = ThreeDAxes(
            x_range=[-3, 3],
            y_range=[-3, 3],
            z_range=[-3, 3]
        )

        # 创建立方体
        cube = Cube(side_length=2, fill_opacity=0.7, stroke_width=2)
        cube.set_color(BLUE)

        # 面的标签
        a_label = Text("a", font_size=36).set_color(YELLOW)
        a_label.next_to(cube, RIGHT)

        # 表面积公式
        area_formula = Text(
            "A = 6a^2"
        ).to_corner(UL)

        # 将所有内容添加到场景
        self.add(axes)
        self.play(Create(cube))
        self.wait()
        self.play(Write(a_label))
        self.wait()
        self.play(Write(area_formula))
        self.wait()

        # 旋转相机以获得更好的视角
        self.begin_ambient_camera_rotation(rate=0.2)
        self.wait(5)
        self.stop_ambient_camera_rotation()
`;
}

