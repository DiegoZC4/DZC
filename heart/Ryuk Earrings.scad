wire = 1;
symmetry = [-1,1];
linkLength = 8;
linkWidth = 5;
linkCornerR = 2;
numLinks = 6;
linkTilt = 60;
$fn=20;

module link(notch=0){
  column = linkLength-linkCornerR*2;
  beam = linkWidth-linkCornerR*2;
  for (i=symmetry){
    translate([i*linkWidth/2,0,0]){
      // columns
      cylinder(h=column,r=wire, center=true);
      // corners
      for (j=symmetry)
      rotate([j*90,0,0]) translate([-i*linkCornerR,i*column/2,0]) 
      rotate_extrude(angle=90) translate([i*linkCornerR,0,0]) circle(r=wire);
    }
    // beams
    translate([0,0,i*linkLength/2]) rotate([0,90,0]) 
    cylinder(h=beam,r=notch && (i==notch) ? wire/2 : wire, center=true);
  }
}

module chain(){
  for (i=[1:numLinks]){
    translate([0,(i-(numLinks+1)/2)*linkLength * 2/3,0]) 
    rotate([90,i%2 ? linkTilt: -linkTilt,0])
    // link(i==1? 1: i==links ? -1: 0);
    link();
  }
}

heartRadius = linkLength/2;
heartLength = linkLength*1.5;

snapArc = 210;
module heart(Scale=2.5, zStretch=1.2){
//  translate([0,wire*4,0])
//  rotate([0,90,0])
//  rotate([0,0,180-(snapArc-180)/2]) 
//  rotate_extrude(angle=snapArc) 
//  translate([wire*2,0,0]) circle(wire);
  difference(){
    scale([Scale,Scale,Scale*zStretch]) import("./heartMesh.stl");
    translate([0,wire*6,0])
    rotate([90,90,0])
    link();
  }
}

//translate([0,0,linkWidth/2/sqrt(2)+wire])
//translate([0,linkLength*(numLinks-1+0.2)/2,0])
//chain();
heart();

//chain();
//echo("Total Chain Length", numLinks*(linkLength-2*wire) + 2*wire);

